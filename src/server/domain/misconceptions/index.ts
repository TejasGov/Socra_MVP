import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, type DbOrTx } from "@/server/db";
import { writeEvent } from "@/server/events/outbox";
import { resolveTopics } from "@/server/domain/knowledge-graph";

/**
 * Misconception observations (data-pipelines §1.15, PRD §13.5).
 *
 * Detectors (rules, the LLM extractor, faculty tagging) call `recordMisconceptionObservation(tx, input)`.
 *  - Input is validated with zod; malformed AI output is rejected and nothing is stored.
 *  - The label is mapped to a canonical Misconception in the course by slug (key) or case-insensitive label.
 *  - Unknown labels become candidate Misconception rows (source AI_PROPOSED, reviewStatus PENDING). Candidates never
 *    reach learner evidence or faculty analytics until faculty approve them.
 *  - A `misconception_observed` event is written in the same transaction; the learning-evidence consumer turns
 *    approved observations into LearningEvidence.
 */

export const MISCONCEPTION_DETECTOR_MIN_CONFIDENCE = 0;
/** Faculty analytics only count observations at or above this detector confidence. */
export const ANALYTICS_MISCONCEPTION_MIN_CONFIDENCE = 0.6;

export const misconceptionObservationInputSchema = z
  .object({
    userId: z.string().min(1),
    courseId: z.string().min(1),
    /** Canonical slug if the detector knows it. */
    key: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    /** Free-text label from the detector (mapped to canonical when possible). */
    label: z.string().trim().min(3).max(160).optional(),
    topicId: z.string().min(1).optional(),
    confidence: z.number().finite().min(0).max(1),
    detectionMethod: z.enum(["RULE", "LLM", "FACULTY_TAGGED"]),
    detectionVersion: z.string().min(1).max(80),
    modelVersion: z.string().max(120).nullish(),
    assignmentId: z.string().nullish(),
    assignmentVersion: z.number().int().nullish(),
    questionId: z.string().nullish(),
    submissionId: z.string().nullish(),
    codeRunId: z.string().nullish(),
    aiSessionId: z.string().nullish(),
    practiceAttemptId: z.string().nullish(),
    observedAt: z.date().optional(),
    sourceEventId: z.string().nullish(),
    idempotencyKey: z.string().min(1).max(300).optional(),
  })
  .refine((v) => Boolean(v.key || v.label), { message: "key or label is required" });

export type MisconceptionObservationInput = z.input<typeof misconceptionObservationInputSchema>;

export type RecordObservationResult =
  | {
      ok: true;
      observationId: string;
      misconceptionId: string;
      canonical: boolean;
      duplicate: boolean;
    }
  | { ok: false; reason: string };

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Find the canonical (or existing candidate) misconception for a key/label in a course. */
export async function resolveMisconception(
  db: DbOrTx,
  courseId: string,
  ref: { key?: string | null; label?: string | null },
) {
  const keys = [ref.key, ref.label ? slugify(ref.label) : null].filter((k): k is string =>
    Boolean(k),
  );
  if (keys.length > 0) {
    const byKey = await db.misconception.findFirst({
      where: { courseId, key: { in: keys } },
      orderBy: { reviewStatus: "asc" },
    });
    if (byKey) return byKey;
  }
  if (ref.label) {
    return db.misconception.findFirst({
      where: { courseId, label: { equals: ref.label.trim(), mode: "insensitive" } },
    });
  }
  return null;
}

export async function recordMisconceptionObservation(
  tx: DbOrTx,
  raw: unknown,
): Promise<RecordObservationResult> {
  const parsed = misconceptionObservationInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `invalid observation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }
  const input = parsed.data;

  let misconception = await resolveMisconception(tx, input.courseId, input);
  let canonical = misconception?.reviewStatus === "APPROVED";

  if (!misconception) {
    // Unknown label -> candidate for faculty review (never shown in analytics while PENDING).
    let topicId = input.topicId ?? null;
    if (!topicId) {
      const topics = await resolveTopics(tx, {
        questionId: input.questionId,
        assignmentId: input.assignmentId,
      });
      topicId = topics[0]?.topicId ?? null;
    }
    if (!topicId) return { ok: false, reason: "cannot attach candidate misconception to a topic" };
    const topic = await tx.topic.findFirst({
      where: { id: topicId, courseId: input.courseId },
      select: { id: true },
    });
    if (!topic) return { ok: false, reason: "topic not in course" };
    const label = input.label ?? input.key!;
    const key = input.key ?? (slugify(label) || `candidate-${hash(label).slice(0, 10)}`);
    misconception = await tx.misconception.upsert({
      where: { courseId_key: { courseId: input.courseId, key } },
      create: {
        courseId: input.courseId,
        topicId,
        key,
        label,
        description: `Proposed by ${input.detectionMethod.toLowerCase()} detector ${input.detectionVersion}. Pending faculty review.`,
        source: input.detectionMethod === "FACULTY_TAGGED" ? "FACULTY" : "AI_PROPOSED",
        reviewStatus: "PENDING",
      },
      update: {},
    });
    canonical = misconception.reviewStatus === "APPROVED";
  }

  const topicId = input.topicId ?? misconception.topicId;
  const observedAt = input.observedAt ?? new Date();
  const idempotencyKey =
    input.idempotencyKey ??
    `mobs:${hash(
      [
        input.userId,
        misconception.id,
        input.submissionId,
        input.codeRunId,
        input.aiSessionId,
        input.practiceAttemptId,
        input.questionId,
        input.detectionVersion,
        input.sourceEventId,
      ].join("|"),
    )}`;

  const created = await tx.misconceptionObservation.createManyAndReturn({
    data: [
      {
        userId: input.userId,
        courseId: input.courseId,
        topicId,
        misconceptionId: misconception.id,
        assignmentId: input.assignmentId ?? null,
        questionId: input.questionId ?? null,
        submissionId: input.submissionId ?? null,
        codeRunId: input.codeRunId ?? null,
        aiSessionId: input.aiSessionId ?? null,
        practiceAttemptId: input.practiceAttemptId ?? null,
        confidence: input.confidence,
        detectionMethod: input.detectionMethod,
        detectionVersion: input.detectionVersion,
        modelVersion: input.modelVersion ?? null,
        reviewStatus: input.detectionMethod === "FACULTY_TAGGED" ? "APPROVED" : "PENDING",
        sourceEventId: input.sourceEventId ?? null,
        idempotencyKey,
        observedAt,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length === 0) {
    const existing = await tx.misconceptionObservation.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    return {
      ok: true,
      observationId: existing!.id,
      misconceptionId: misconception.id,
      canonical,
      duplicate: true,
    };
  }
  const observationId = created[0]!.id;

  await writeEvent(tx, {
    eventName: "misconception_observed",
    actorId: input.userId,
    courseId: input.courseId,
    assignmentId: input.assignmentId ?? null,
    assignmentVersion: input.assignmentVersion ?? null,
    questionId: input.questionId ?? null,
    sessionId: input.aiSessionId ?? null,
    occurredAt: observedAt,
    idempotencyKey: `misconception_observed:${observationId}`,
    metadata: {
      observationId,
      misconceptionId: misconception.id,
      topicId,
      confidence: input.confidence,
      detectorVersion: input.detectionVersion,
    },
  });

  return {
    ok: true,
    observationId,
    misconceptionId: misconception.id,
    canonical,
    duplicate: false,
  };
}

/** Faculty review of a candidate (promote to canonical or reject). */
export async function reviewMisconceptionCandidate(
  misconceptionId: string,
  decision: "APPROVED" | "REJECTED",
  reviewerId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.misconception.update({
        where: { id: misconceptionId },
        data: { reviewStatus: decision, createdById: reviewerId },
      });
      if (decision !== "APPROVED") return;
      // Promotion: earlier observations of this label now become learner evidence.
      const { ingestMisconceptionObservation } = await import("@/server/domain/learner/ingest");
      const obs = await tx.misconceptionObservation.findMany({
        where: { misconceptionId },
        select: { id: true, sourceEventId: true },
      });
      for (const o of obs) await ingestMisconceptionObservation(tx, o.id, o.sourceEventId);
    },
    { timeout: 60_000 },
  );
}

export async function listMisconceptionCandidates(courseId: string) {
  return prisma.misconception.findMany({
    where: { courseId, reviewStatus: "PENDING" },
    select: { id: true, key: true, label: true, topicId: true, source: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}
