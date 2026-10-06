import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { EventStatus } from "@/generated/prisma/enums";
import { prisma, type DbOrTx } from "../db";
import { env } from "../env";
import { buildEnvelope, envelopeToRow, type EventInput } from "./envelope";
import type { EventName } from "./taxonomy";

/**
 * Transactional outbox (TASK §19, data-pipelines §1.4).
 *
 * Usage — the domain write and the event commit atomically:
 *
 *   await prisma.$transaction(async (tx) => {
 *     const submission = await tx.submission.create({ ... });
 *     await writeEvent(tx, {
 *       eventName: "submission_completed",
 *       actorId: user.id, courseId, assignmentId, assignmentVersion,
 *       idempotencyKey: `submission_completed:${submission.id}`,
 *       metadata: { submissionId: submission.id, attemptNumber, snapshotHash },
 *     });
 *   });
 *
 * Idempotent on `idempotencyKey`: a second call with the same key inserts nothing and returns the original eventId
 * (`duplicate: true`). Inserts use ON CONFLICT DO NOTHING so a duplicate never aborts the caller's transaction.
 *
 * QUARANTINED events (invalid metadata, forbidden keys, missing assignmentVersion) are stored for inspection with
 * an outbox row in status QUARANTINED; they are never dispatched to consumers.
 */

export interface WriteEventResult {
  eventId: string;
  status: EventStatus;
  duplicate: boolean;
  quarantineReason: string | null;
}

export async function writeEvent<N extends EventName>(
  db: DbOrTx,
  input: EventInput<N>,
): Promise<WriteEventResult> {
  const validated = await buildEnvelope(db, input);
  const row = envelopeToRow(validated);

  const inserted = await db.analyticsEvent.createMany({ data: [row], skipDuplicates: true });
  if (inserted.count === 0) {
    const existing = await db.analyticsEvent.findUnique({
      where: { idempotencyKey: row.idempotencyKey },
      select: { id: true, status: true, quarantineReason: true },
    });
    if (!existing) {
      // Conflict on the primary key (astronomically unlikely UUID collision) — surface it.
      throw new Error(`writeEvent: could not insert event ${row.id} (${row.idempotencyKey})`);
    }
    return {
      eventId: existing.id,
      status: existing.status,
      duplicate: true,
      quarantineReason: existing.quarantineReason,
    };
  }

  if (validated.status === "QUARANTINED") {
    console.warn(`[outbox] quarantined ${input.eventName}: ${validated.quarantineReason}`);
  }

  await db.outboxEvent.createMany({
    data: [
      {
        eventId: validated.envelope.eventId,
        eventName: validated.envelope.eventName,
        payload: validated.envelope as unknown as Prisma.InputJsonValue,
        status: validated.status === "QUARANTINED" ? "QUARANTINED" : "PENDING",
        maxAttempts: env().OUTBOX_MAX_ATTEMPTS,
        lastError: validated.quarantineReason,
      },
    ],
    skipDuplicates: true,
  });

  return {
    eventId: validated.envelope.eventId,
    status: validated.status,
    duplicate: false,
    quarantineReason: validated.quarantineReason,
  };
}

/** Convenience: write several events in the caller's transaction (sequential to keep ordering). */
export async function writeEvents(
  db: DbOrTx,
  inputs: readonly EventInput[],
): Promise<WriteEventResult[]> {
  const results: WriteEventResult[] = [];
  for (const input of inputs) results.push(await writeEvent(db, input));
  return results;
}

/** Fire-and-forget style for reads (e.g. analytics_viewed) where no domain write exists. Never throws. */
export async function recordEvent<N extends EventName>(
  input: EventInput<N>,
): Promise<WriteEventResult | null> {
  try {
    return await prisma.$transaction((tx) => writeEvent(tx, input));
  } catch (err) {
    console.error(`[outbox] failed to record ${input.eventName}`, err);
    return null;
  }
}
