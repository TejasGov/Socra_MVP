import "server-only";
import { hostname } from "node:os";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import type { EventEnvelope } from "./envelope";
import { consumersFor, type EventConsumer } from "./consumers/registry";

/**
 * Outbox dispatcher (runs in the worker; never in the Next.js request path).
 *
 *   claimBatch()   UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) — safe with several workers.
 *                  Rows stuck in PROCESSING longer than STALE_LOCK_MS are reclaimed.
 *   dispatchRow()  For each registered consumer of the event: skip if ProcessedEvent(consumer, eventId) exists,
 *                  otherwise run it and record ProcessedEvent (atomically for transactional consumers).
 *   outcome        all consumers ok -> PROCESSED; any failure -> PENDING with exponential backoff
 *                  (attempts < maxAttempts) or FAILED + BackgroundJobFailure row.
 */

export const STALE_LOCK_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;

export interface ClaimedOutboxRow {
  id: string;
  eventId: string;
  eventName: string;
  payload: EventEnvelope;
  attempts: number;
  maxAttempts: number;
}

export interface DispatchSummary {
  claimed: number;
  processed: number;
  retried: number;
  failed: number;
}

export const defaultWorkerId = `${hostname()}:${process.pid}`;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export async function claimBatch(workerId: string, batchSize: number): Promise<ClaimedOutboxRow[]> {
  // Use the application clock (not the DB's now()): availableAt/createdAt are written by the app, and host vs
  // container clocks can drift (observed with Docker Desktop on Windows).
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  return prisma.$queryRaw<ClaimedOutboxRow[]>`
    UPDATE "OutboxEvent" AS o
    SET "status" = 'PROCESSING'::"OutboxStatus",
        "lockedAt" = ${now},
        "lockedBy" = ${workerId},
        "attempts" = o."attempts" + 1
    WHERE o."id" IN (
      SELECT "id" FROM "OutboxEvent"
      WHERE ("status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now})
         OR ("status" = 'PROCESSING'::"OutboxStatus" AND "lockedAt" < ${staleBefore})
      ORDER BY "availableAt", "createdAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING o."id", o."eventId", o."eventName", o."payload", o."attempts", o."maxAttempts"`;
}

async function runConsumer(
  consumer: EventConsumer,
  event: EventEnvelope,
): Promise<"ran" | "skipped"> {
  if (consumer.transactional === false) {
    const already = await prisma.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: consumer.name, eventId: event.eventId } },
      select: { id: true },
    });
    if (already) return "skipped";
    await consumer.handle(event, prisma as unknown as Prisma.TransactionClient);
    await prisma.processedEvent.createMany({
      data: [{ consumer: consumer.name, eventId: event.eventId }],
      skipDuplicates: true,
    });
    return "ran";
  }
  return prisma.$transaction(
    async (tx) => {
      const ledger = await tx.processedEvent.createMany({
        data: [{ consumer: consumer.name, eventId: event.eventId }],
        skipDuplicates: true,
      });
      if (ledger.count === 0) return "skipped" as const;
      await consumer.handle(event, tx);
      return "ran" as const;
    },
    { timeout: 30_000 },
  );
}

/** Dispatch one claimed row to all its consumers and record the outcome. */
export async function dispatchRow(
  row: ClaimedOutboxRow,
): Promise<"processed" | "retried" | "failed"> {
  const errors: string[] = [];
  for (const consumer of consumersFor(row.eventName)) {
    try {
      await runConsumer(consumer, row.payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${consumer.name}: ${message}`);
      console.error(
        `[outbox] consumer ${consumer.name} failed on ${row.eventName} ${row.eventId}`,
        err,
      );
    }
  }

  if (errors.length === 0) {
    await prisma.outboxEvent.update({
      where: { id: row.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
    return "processed";
  }

  const lastError = errors.join(" | ").slice(0, 4000);
  if (row.attempts >= row.maxAttempts) {
    await prisma.$transaction([
      prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError },
      }),
      prisma.backgroundJobFailure.create({
        data: {
          queue: "outbox",
          jobName: row.eventName,
          jobId: row.eventId,
          payload: { outboxId: row.id, eventId: row.eventId, eventName: row.eventName },
          error: lastError,
          attempts: row.attempts,
        },
      }),
    ]);
    return "failed";
  }

  await prisma.outboxEvent.update({
    where: { id: row.id },
    data: {
      status: "PENDING",
      availableAt: new Date(Date.now() + backoffMs(row.attempts)),
      lockedAt: null,
      lockedBy: null,
      lastError,
    },
  });
  return "retried";
}

/** Claim and dispatch one batch. Returns counts (claimed = 0 means the outbox is drained). */
export async function dispatchOnce(
  opts: { workerId?: string; batchSize?: number } = {},
): Promise<DispatchSummary> {
  const rows = await claimBatch(
    opts.workerId ?? defaultWorkerId,
    opts.batchSize ?? env().OUTBOX_BATCH_SIZE,
  );
  const summary: DispatchSummary = { claimed: rows.length, processed: 0, retried: 0, failed: 0 };
  for (const row of rows) {
    const outcome = await dispatchRow(row);
    summary[outcome] += 1;
  }
  return summary;
}

/** Drain everything currently available (used by the seed and integration tests). */
export async function drainOutbox(maxBatches = 1000): Promise<DispatchSummary> {
  const total: DispatchSummary = { claimed: 0, processed: 0, retried: 0, failed: 0 };
  for (let i = 0; i < maxBatches; i++) {
    const s = await dispatchOnce();
    total.claimed += s.claimed;
    total.processed += s.processed;
    total.retried += s.retried;
    total.failed += s.failed;
    if (s.claimed === 0) break;
  }
  return total;
}

/** Outbox depth by status (health endpoints). */
export async function outboxDepth(): Promise<Record<string, number>> {
  const rows = await prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}
