import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { disconnectPrisma, prisma } from "@/server/db";
import { clearConsumers, registerConsumer } from "@/server/events/consumers/registry";
import { dispatchOnce, drainOutbox } from "@/server/events/dispatcher";
import { writeEvent } from "@/server/events/outbox";

const RUN = randomUUID().slice(0, 8);
const courseId = `itest_course_${RUN}`;

beforeAll(async () => {
  // Make sure leftover pending rows from earlier runs don't get dispatched to this run's test consumers.
  await prisma.outboxEvent.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
});

afterEach(() => clearConsumers());

afterAll(async () => {
  await disconnectPrisma();
});

describe("transactional outbox", () => {
  it("writeEvent is idempotent on idempotencyKey (one event, one outbox row)", async () => {
    const key = `course_opened:${RUN}:idem`;
    const first = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "course_opened",
        actorId: null,
        courseId,
        idempotencyKey: key,
        metadata: {},
      }),
    );
    const second = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "course_opened",
        actorId: null,
        courseId,
        idempotencyKey: key,
        metadata: {},
      }),
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId);
    expect(await prisma.analyticsEvent.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { eventId: first.eventId } })).toBe(1);
  });

  it("rolls back the event when the caller's transaction fails", async () => {
    const key = `course_opened:${RUN}:rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await writeEvent(tx, {
          eventName: "course_opened",
          courseId,
          idempotencyKey: key,
          metadata: {},
        });
        throw new Error("domain write failed");
      }),
    ).rejects.toThrow("domain write failed");
    expect(await prisma.analyticsEvent.count({ where: { idempotencyKey: key } })).toBe(0);
  });

  it("a duplicate inside the same transaction does not abort it", async () => {
    const key = `course_opened:${RUN}:same-tx`;
    const results = await prisma.$transaction(async (tx) => {
      const a = await writeEvent(tx, {
        eventName: "course_opened",
        courseId,
        idempotencyKey: key,
        metadata: {},
      });
      const b = await writeEvent(tx, {
        eventName: "course_opened",
        courseId,
        idempotencyKey: key,
        metadata: {},
      });
      return [a, b];
    });
    expect(results[1]?.duplicate).toBe(true);
  });

  it("quarantines events missing assignmentVersion and never dispatches them", async () => {
    const seen: string[] = [];
    registerConsumer({
      name: `itest-q-${RUN}`,
      events: "*",
      handle: async (e) => void seen.push(e.eventId),
    });
    const res = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "assignment_opened",
        courseId,
        assignmentId: `a_${RUN}`,
        idempotencyKey: `assignment_opened:${RUN}:q`,
        metadata: {},
      }),
    );
    expect(res.status).toBe("QUARANTINED");
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: res.eventId } });
    expect(row.status).toBe("QUARANTINED");
    await drainOutbox(50);
    expect(seen).not.toContain(res.eventId);
  });

  it("dispatches each event to each consumer exactly once, even on replay", async () => {
    let count = 0;
    const consumerName = `itest-counter-${RUN}`;
    registerConsumer({
      name: consumerName,
      events: ["course_opened"],
      handle: async (e) => {
        if (e.courseId === courseId && e.idempotencyKey.endsWith(":dispatch")) count++;
      },
    });
    const res = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "course_opened",
        courseId,
        idempotencyKey: `course_opened:${RUN}:dispatch`,
        metadata: {},
      }),
    );
    await drainOutbox(50);
    expect(count).toBe(1);
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: res.eventId } });
    expect(row.status).toBe("PROCESSED");

    // Simulate a replay (e.g. crash after consumer commit but before outbox status update).
    await prisma.outboxEvent.update({
      where: { id: row.id },
      data: { status: "PENDING", availableAt: new Date() },
    });
    await drainOutbox(50);
    expect(count).toBe(1);
    expect(
      await prisma.processedEvent.count({
        where: { consumer: consumerName, eventId: res.eventId },
      }),
    ).toBe(1);
  });

  it("retries failing consumers with backoff and records terminal failures", async () => {
    const consumerName = `itest-fail-${RUN}`;
    registerConsumer({
      name: consumerName,
      events: ["course_opened"],
      handle: async (e) => {
        if (e.idempotencyKey.endsWith(":fail")) throw new Error("boom");
      },
    });
    const res = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "course_opened",
        courseId,
        idempotencyKey: `course_opened:${RUN}:fail`,
        metadata: {},
      }),
    );
    await prisma.outboxEvent.update({ where: { eventId: res.eventId }, data: { maxAttempts: 2 } });

    await dispatchOnce({ batchSize: 50 });
    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: res.eventId } });
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastError).toContain("boom");

    await prisma.outboxEvent.update({ where: { id: row.id }, data: { availableAt: new Date() } });
    await dispatchOnce({ batchSize: 50 });
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { eventId: res.eventId } });
    expect(row.status).toBe("FAILED");
    expect(await prisma.backgroundJobFailure.count({ where: { jobId: res.eventId } })).toBe(1);
    // The ledger must not contain a row for the failed consumer.
    expect(
      await prisma.processedEvent.count({
        where: { consumer: consumerName, eventId: res.eventId },
      }),
    ).toBe(0);
  });

  it("AnalyticsEvent rows are append-only at the database level", async () => {
    const res = await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "course_opened",
        courseId,
        idempotencyKey: `course_opened:${RUN}:immutable`,
        metadata: {},
      }),
    );
    await expect(
      prisma.analyticsEvent.update({ where: { id: res.eventId }, data: { courseId: "tampered" } }),
    ).rejects.toThrow();
    await expect(prisma.analyticsEvent.delete({ where: { id: res.eventId } })).rejects.toThrow();
  });
});
