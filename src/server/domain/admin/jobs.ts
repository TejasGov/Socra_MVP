import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import { pingRedis } from "@/server/redis";

const OUTBOX_STATUSES = ["PENDING", "PROCESSING", "PROCESSED", "FAILED", "QUARANTINED"] as const;

async function queueDepths(): Promise<{
  available: boolean;
  queues: Array<{ name: string; counts: Record<string, number> }>;
}> {
  if (!(await pingRedis(1500))) return { available: false, queues: [] };
  const queues = await Promise.all(
    Object.values(QUEUE_NAMES).map(async (name) => {
      try {
        const counts = await Promise.race([
          getQueue(name).getJobCounts("waiting", "active", "delayed", "failed", "completed"),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
        ]);
        return { name, counts: counts as Record<string, number> };
      } catch {
        return { name, counts: {} };
      }
    }),
  );
  return { available: true, queues };
}

export async function getJobsOverview(user: Principal) {
  assertCan(user, "admin:jobs:read");
  const [failures, unresolvedCount, outboxRows, failedOutbox, queues] = await Promise.all([
    prisma.backgroundJobFailure.findMany({ orderBy: { failedAt: "desc" }, take: 50 }),
    prisma.backgroundJobFailure.count({ where: { resolvedAt: null } }),
    prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboxEvent.findMany({
      where: { status: { in: ["FAILED", "QUARANTINED"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        eventName: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        createdAt: true,
      },
    }),
    queueDepths(),
  ]);
  const counts = Object.fromEntries(OUTBOX_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  for (const r of outboxRows) counts[r.status] = r._count._all;
  return {
    failures: failures.map((f) => ({
      id: f.id,
      queue: f.queue,
      jobName: f.jobName,
      jobId: f.jobId,
      error: f.error,
      attempts: f.attempts,
      failedAt: f.failedAt,
      resolvedAt: f.resolvedAt,
    })),
    unresolvedCount,
    outbox: { counts, problemRows: failedOutbox },
    queues,
  };
}

export const outboxRetrySchema = z.object({
  /** Specific outbox ids, or omit to retry every FAILED row. QUARANTINED rows are never retried (they are invalid). */
  ids: z.array(z.string().min(1)).max(500).optional(),
});

/** Re-queue FAILED outbox rows for the dispatcher. Audited. */
export async function retryFailedOutbox(user: Principal, input: z.infer<typeof outboxRetrySchema>) {
  assertCan(user, "admin:jobs:read");
  assertCan(user, "admin:health:read");
  return prisma.$transaction(async (tx) => {
    const result = await tx.outboxEvent.updateMany({
      where: { status: "FAILED", ...(input.ids ? { id: { in: input.ids } } : {}) },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "jobs.outbox_retry",
        targetType: "OutboxEvent",
        metadata: { retried: result.count, ids: input.ids ?? "all_failed" },
      },
      tx,
    );
    return { retried: result.count };
  });
}

export async function resolveJobFailure(user: Principal, failureId: string) {
  assertCan(user, "admin:jobs:read");
  return prisma.$transaction(async (tx) => {
    const f = await tx.backgroundJobFailure.findUnique({ where: { id: failureId } });
    if (!f) throw new HttpError(404, "failure_not_found", "Failure not found");
    if (f.resolvedAt) return { resolved: true };
    await tx.backgroundJobFailure.update({
      where: { id: failureId },
      data: { resolvedAt: new Date(), resolvedById: user.id },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "jobs.failure_resolve",
        targetType: "BackgroundJobFailure",
        targetId: failureId,
        metadata: { queue: f.queue, jobName: f.jobName },
      },
      tx,
    );
    return { resolved: true };
  });
}
