import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/server/db";
import { writeEvent } from "@/server/events/outbox";
import { staticWeight } from "./topic-state";
import type { RecordEvidenceInput, RecordEvidenceResult } from "./types";

const EVIDENCE_TYPES = [
  "FIRST_ATTEMPT_CORRECTNESS",
  "FINAL_CORRECTNESS",
  "RETRY_IMPROVEMENT",
  "SOCRA_USAGE",
  "INTERVENTION_DEPTH",
  "RECOVERY_AFTER_GUIDANCE",
  "MISCONCEPTION_OBSERVED",
  "PRACTICE_SUCCESS",
  "TRANSFER",
] as const;
const SOURCE_TYPES = [
  "SUBMISSION",
  "CODE_RUN",
  "SOCRA_SESSION",
  "PRACTICE",
  "GRADE",
  "MISCONCEPTION_DETECTOR",
  "FACULTY",
] as const;

/** Validation for every evidence row (malformed inputs are rejected, never stored). */
export const evidenceInputSchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().min(1),
  topicId: z.string().min(1),
  evidenceType: z.enum(EVIDENCE_TYPES),
  sourceType: z.enum(SOURCE_TYPES),
  value: z.number().finite().min(0).max(1),
  occurredAt: z.date(),
  idempotencyKey: z.string().min(1).max(500),
  maxInterventionLevel: z.number().int().min(0).max(6).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  difficulty: z.number().int().min(0).max(10).nullable().optional(),
  attemptNumber: z.number().int().min(1).nullable().optional(),
});

/**
 * Append one LearningEvidence row. Idempotent on `idempotencyKey` (a replay returns the existing row with
 * created=false and writes nothing). Throws on invalid input.
 */
export async function recordEvidence(
  tx: DbOrTx,
  input: RecordEvidenceInput,
): Promise<RecordEvidenceResult> {
  evidenceInputSchema.parse(input);
  const assisted = input.assisted ?? (input.maxInterventionLevel ?? 0) > 0;
  const weight = staticWeight({
    evidenceType: input.evidenceType,
    sourceType: input.sourceType,
    maxInterventionLevel: input.maxInterventionLevel ?? null,
    assisted,
  });
  const sourceEventIds = input.sourceEventIds ?? (input.sourceEventId ? [input.sourceEventId] : []);

  const inserted = await tx.learningEvidence.createManyAndReturn({
    data: [
      {
        userId: input.userId,
        courseId: input.courseId,
        topicId: input.topicId,
        assignmentId: input.assignmentId ?? null,
        assignmentVersion: input.assignmentVersion ?? null,
        questionId: input.questionId ?? null,
        questionVersion: input.questionVersion ?? null,
        practiceItemId: input.practiceItemId ?? null,
        aiSessionId: input.aiSessionId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        evidenceType: input.evidenceType,
        value: input.value,
        rawValue: (input.rawValue ?? undefined) as Prisma.InputJsonValue | undefined,
        weight,
        assisted,
        maxInterventionLevel: input.maxInterventionLevel ?? null,
        difficulty: input.difficulty ?? null,
        attemptNumber: input.attemptNumber ?? null,
        confidence: input.confidence ?? 1,
        modelVersion: input.modelVersion ?? null,
        detectorVersion: input.detectorVersion ?? null,
        policyVersion: input.policyVersion ?? null,
        researchCondition: input.researchCondition ?? null,
        sourceEventId: input.sourceEventId ?? null,
        sourceEventIds,
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.occurredAt,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });

  if (inserted.length === 0) {
    const existing = await tx.learningEvidence.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (!existing) throw new Error(`recordEvidence: conflict on ${input.idempotencyKey}`);
    return { id: existing.id, created: false };
  }

  const id = inserted[0]!.id;
  if (input.emitEvent !== false) {
    await writeEvent(tx, {
      eventName: "learning_evidence_recorded",
      actorId: input.userId,
      courseId: input.courseId,
      // Assignment-scoped fields omitted: this derived event is keyed by evidence id.
      questionId: input.questionId ?? null,
      occurredAt: input.occurredAt,
      idempotencyKey: `learning_evidence_recorded:${id}`,
      researchCondition: input.researchCondition ?? null,
      metadata: {
        evidenceId: id,
        topicId: input.topicId,
        evidenceType: input.evidenceType,
        value: input.value,
        sourceEventIds,
      },
    });
  }
  return { id, created: true };
}

/** Mark rows as invalidated (append-only table: only invalidation fields may change). */
export async function invalidateEvidence(
  tx: DbOrTx,
  where: Prisma.LearningEvidenceWhereInput,
  reason: string,
): Promise<number> {
  const res = await tx.learningEvidence.updateMany({
    where: { ...where, invalidatedAt: null },
    data: { invalidatedAt: new Date(), invalidationReason: reason },
  });
  return res.count;
}
