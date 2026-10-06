import "server-only";
import type { EvidenceType, GradeStatus } from "@/generated/prisma/enums";
import type { DbOrTx } from "@/server/db";
import type { EventEnvelope } from "@/server/events/envelope";
import { EVENTS } from "@/server/events/taxonomy";
import { resolveTopics } from "@/server/domain/knowledge-graph";
import { invalidateEvidence, recordEvidence } from "./evidence";
import { recomputeTopicStatesTx } from "./recompute";

/**
 * Event -> LearningEvidence normalization (data-pipelines §1.5). Every handler:
 *   1. re-validates the event metadata (malformed input is logged and skipped, never stored),
 *   2. maps the question (QuestionTopic) or assignment (AssignmentTopic) to topics,
 *   3. appends evidence with deterministic idempotency keys (replays are no-ops),
 *   4. recomputes the affected topic states in the same transaction.
 * Evidence about one graded attempt uses keys derived from (submission, question, topic, type, score) so that the
 * deterministic-grade, faculty-finalize and submission events converge on the same rows.
 */

/** A question counts as correct only with full credit. */
export const CORRECT_FRACTION = 0.999;

export interface AssistanceSummary {
  maxLevel: number;
  /** Assistant turns with intervention level >= 1. */
  hintCount: number;
  sessionIds: string[];
}

/**
 * Socra assistance a student received on a question before a point in time, from AiSession/AiMessage metadata
 * (intervention levels and timestamps only; message content is never selected).
 */
export async function assistanceBefore(
  db: DbOrTx,
  ref: {
    userId: string;
    assignmentId: string;
    questionId: string | null;
    before: Date;
    after?: Date | null;
  },
): Promise<AssistanceSummary> {
  const sessions = await db.aiSession.findMany({
    where: {
      userId: ref.userId,
      assignmentId: ref.assignmentId,
      mode: { in: ["PROTECTED_ASSESSMENT", "POST_ASSESSMENT_REVIEW"] },
      startedAt: { lte: ref.before },
      ...(ref.questionId ? { OR: [{ questionId: ref.questionId }, { questionId: null }] } : {}),
    },
    select: { id: true, maxInterventionLevel: true },
  });
  if (sessions.length === 0) return { maxLevel: 0, hintCount: 0, sessionIds: [] };
  const messages = await db.aiMessage.findMany({
    where: {
      sessionId: { in: sessions.map((s) => s.id) },
      role: "ASSISTANT",
      createdAt: { lte: ref.before, ...(ref.after ? { gt: ref.after } : {}) },
      interventionLevel: { not: null },
    },
    select: { interventionLevel: true },
  });
  let maxLevel = 0;
  let hintCount = 0;
  for (const m of messages) {
    const l = m.interventionLevel ?? 0;
    maxLevel = Math.max(maxLevel, l);
    if (l >= 1) hintCount += 1;
  }
  if (messages.length === 0 && !ref.after) {
    // Sessions without per-message levels (older data): fall back to the session maximum.
    maxLevel = Math.max(0, ...sessions.map((s) => s.maxInterventionLevel));
  }
  return { maxLevel, hintCount, sessionIds: sessions.map((s) => s.id) };
}

function validMetadata(event: EventEnvelope): boolean {
  const def = EVENTS[event.eventName];
  if (!def) return false;
  const ok = def.metadata.safeParse(event.metadata).success;
  if (!ok) console.warn(`[learner] skipping malformed ${event.eventName} ${event.eventId}`);
  return ok;
}

interface GradeLike {
  questionId: string | null;
  scope: "SUBMISSION" | "QUESTION";
  status: GradeStatus;
  method: string;
  graderType: string;
  rawPoints: number | null;
  finalScore: number | null;
  facultyOverride: number | null;
  maxPoints: number;
}

/** Score fraction for a grade, or null when it is not authoritative (AI suggestions never count). */
export function gradeFraction(g: GradeLike): number | null {
  if (g.maxPoints <= 0) return null;
  let points: number | null = null;
  if (g.status === "FINAL") points = g.finalScore ?? g.facultyOverride ?? g.rawPoints;
  else if (g.method === "DETERMINISTIC_TESTS" && g.graderType === "SYSTEM") points = g.rawPoints;
  if (points === null || !Number.isFinite(points)) return null;
  return Math.min(1, Math.max(0, points / g.maxPoints));
}

/** Per-question fractions for a submission (question grades; single-question submission-level fallback). */
async function questionFractions(
  db: DbOrTx,
  submissionId: string,
  questionIds: string[],
): Promise<Map<string, number>> {
  const grades = await db.grade.findMany({
    where: { submissionId },
    select: {
      questionId: true,
      scope: true,
      status: true,
      method: true,
      graderType: true,
      rawPoints: true,
      finalScore: true,
      facultyOverride: true,
      maxPoints: true,
    },
  });
  const out = new Map<string, number>();
  for (const g of grades) {
    if (g.scope !== "QUESTION" || !g.questionId) continue;
    const f = gradeFraction(g);
    if (f !== null) out.set(g.questionId, f);
  }
  if (out.size === 0 && questionIds.length === 1) {
    const overall = grades.find((g) => g.scope === "SUBMISSION");
    const f = overall ? gradeFraction(overall) : null;
    if (f !== null) out.set(questionIds[0]!, f);
  }
  return out;
}

const fkey = (f: number) => f.toFixed(3);

/** Evidence for every graded question of a submission. Safe to call repeatedly (converges). */
export async function ingestSubmissionGrades(
  tx: DbOrTx,
  submissionId: string,
  sourceEventId: string,
): Promise<{ evidence: number }> {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      assignmentId: true,
      attemptNumber: true,
      submittedAt: true,
      researchCondition: true,
      policyVersion: true,
      assignmentVersion: { select: { version: true } },
      answers: {
        select: {
          questionId: true,
          questionVersion: { select: { version: true, difficulty: true } },
        },
      },
    },
  });
  if (!sub) return { evidence: 0 };
  const questionIds = sub.answers.map((a) => a.questionId);
  const fractions = await questionFractions(tx, sub.id, questionIds);
  if (fractions.size === 0) return { evidence: 0 };

  // Earlier attempts by this student on this assignment (for first-attempt / retry logic).
  const earlier = await tx.submission.findMany({
    where: {
      userId: sub.userId,
      assignmentId: sub.assignmentId,
      attemptNumber: { lt: sub.attemptNumber },
    },
    select: { id: true, submittedAt: true, attemptNumber: true },
    orderBy: { attemptNumber: "desc" },
  });

  const touchedTopics = new Set<string>();
  let count = 0;
  for (const answer of sub.answers) {
    const fraction = fractions.get(answer.questionId);
    if (fraction === undefined) continue;
    const topics = await resolveTopics(tx, {
      questionId: answer.questionId,
      assignmentId: sub.assignmentId,
    });
    if (topics.length === 0) continue;

    // Most recent earlier graded attempt on this question.
    let prev: { fraction: number; submittedAt: Date } | null = null;
    for (const e of earlier) {
      const f = (await questionFractions(tx, e.id, [answer.questionId])).get(answer.questionId);
      if (f !== undefined) {
        prev = { fraction: f, submittedAt: e.submittedAt };
        break;
      }
    }
    const assistance = await assistanceBefore(tx, {
      userId: sub.userId,
      assignmentId: sub.assignmentId,
      questionId: answer.questionId,
      before: sub.submittedAt,
    });
    const assistanceSincePrev = prev
      ? await assistanceBefore(tx, {
          userId: sub.userId,
          assignmentId: sub.assignmentId,
          questionId: answer.questionId,
          before: sub.submittedAt,
          after: prev.submittedAt,
        })
      : assistance;

    const items: { type: EvidenceType; value: number }[] = [];
    if (!prev) {
      items.push({ type: "FIRST_ATTEMPT_CORRECTNESS", value: fraction });
    } else {
      items.push({ type: "FINAL_CORRECTNESS", value: fraction });
      if (prev.fraction < CORRECT_FRACTION) {
        const gain = (fraction - prev.fraction) / (1 - prev.fraction);
        items.push({ type: "RETRY_IMPROVEMENT", value: Math.min(1, Math.max(0, gain)) });
      }
      if (assistanceSincePrev.hintCount > 0 || assistanceSincePrev.maxLevel > 0) {
        items.push({
          type: "RECOVERY_AFTER_GUIDANCE",
          value: fraction >= CORRECT_FRACTION ? 1 : 0,
        });
      }
    }

    for (const t of topics) {
      for (const item of items) {
        const base = `sub:${sub.id}:${answer.questionId}:${t.topicId}:${item.type}`;
        const key = `${base}:${fkey(fraction)}`;
        // A regrade with a different score supersedes the earlier row for the same attempt.
        await invalidateEvidence(
          tx,
          {
            sourceId: sub.id,
            questionId: answer.questionId,
            topicId: t.topicId,
            evidenceType: item.type,
            idempotencyKey: { not: key },
          },
          "superseded_by_regrade",
        );
        const r = await recordEvidence(tx, {
          userId: sub.userId,
          courseId: sub.courseId,
          topicId: t.topicId,
          evidenceType: item.type,
          sourceType: "SUBMISSION",
          sourceId: sub.id,
          value: item.value,
          rawValue: {
            fraction,
            correct: fraction >= CORRECT_FRACTION,
            attemptNumber: sub.attemptNumber,
            hintCount: assistance.hintCount,
            maxInterventionLevel: assistance.maxLevel,
            topicWeight: t.weight,
          },
          occurredAt: sub.submittedAt,
          idempotencyKey: key,
          assignmentId: sub.assignmentId,
          assignmentVersion: sub.assignmentVersion.version,
          questionId: answer.questionId,
          questionVersion: answer.questionVersion.version,
          difficulty: answer.questionVersion.difficulty,
          attemptNumber: sub.attemptNumber,
          assisted: assistance.maxLevel > 0 || assistance.hintCount > 0,
          maxInterventionLevel: assistance.maxLevel,
          policyVersion: sub.policyVersion != null ? String(sub.policyVersion) : null,
          researchCondition: sub.researchCondition,
          sourceEventId,
          emitEvent: true,
        });
        if (r.created) count += 1;
        touchedTopics.add(t.topicId);
      }
    }
  }

  if (touchedTopics.size > 0) {
    await recomputeTopicStatesTx(tx, sub.userId, sub.courseId, { topicIds: [...touchedTopics] });
  }
  return { evidence: count };
}

export async function handleSubmissionEvent(tx: DbOrTx, event: EventEnvelope): Promise<void> {
  if (!validMetadata(event)) return;
  const submissionId = String(event.metadata.submissionId);
  await ingestSubmissionGrades(tx, submissionId, event.eventId);
}

export async function handlePracticeAnswered(tx: DbOrTx, event: EventEnvelope): Promise<void> {
  if (!validMetadata(event)) return;
  const m = event.metadata as { attemptId: string; isCorrect: boolean | null; assisted: boolean };
  const attempt = await tx.practiceItemAttempt.findUnique({
    where: { id: m.attemptId },
    select: {
      id: true,
      userId: true,
      itemId: true,
      isCorrect: true,
      score: true,
      attemptNumber: true,
      difficulty: true,
      hintsUsed: true,
      explanationRequested: true,
      assisted: true,
      answeredAt: true,
      shownAt: true,
      item: { select: { topicId: true, courseId: true } },
      session: { select: { researchCondition: true } },
    },
  });
  if (!attempt) return;
  const correct = attempt.isCorrect ?? m.isCorrect;
  const value = correct === null ? attempt.score : correct ? 1 : (attempt.score ?? 0);
  if (value === null || value === undefined) return;
  const assisted = attempt.assisted || m.assisted || attempt.hintsUsed > 0;
  const level = attempt.explanationRequested
    ? 5
    : attempt.hintsUsed > 0
      ? Math.min(5, 1 + attempt.hintsUsed)
      : assisted
        ? 2
        : 0;
  const topicId = attempt.item.topicId;
  await recordEvidence(tx, {
    userId: attempt.userId,
    courseId: attempt.item.courseId,
    topicId,
    evidenceType: "PRACTICE_SUCCESS",
    sourceType: "PRACTICE",
    sourceId: attempt.id,
    value: Math.min(1, Math.max(0, value)),
    rawValue: {
      correct,
      hintsUsed: attempt.hintsUsed,
      explanationRequested: attempt.explanationRequested,
    },
    occurredAt: attempt.answeredAt ?? new Date(event.occurredAt),
    idempotencyKey: `practice:${attempt.id}:${topicId}:PRACTICE_SUCCESS`,
    practiceItemId: attempt.itemId,
    difficulty: attempt.difficulty,
    attemptNumber: attempt.attemptNumber,
    assisted,
    maxInterventionLevel: level,
    researchCondition: attempt.session.researchCondition,
    sourceEventId: event.eventId,
  });
  await recomputeTopicStatesTx(tx, attempt.userId, attempt.item.courseId, { topicIds: [topicId] });
}

async function topicsForSocraEvent(tx: DbOrTx, event: EventEnvelope) {
  const viaRef = await resolveTopics(tx, {
    questionId: event.questionId,
    assignmentId: event.assignmentId,
  });
  if (viaRef.length > 0 || !event.sessionId) return viaRef;
  const session = await tx.aiSession.findUnique({
    where: { id: event.sessionId },
    select: { practiceSession: { select: { topicId: true } } },
  });
  const t = session?.practiceSession?.topicId;
  return t ? [{ topicId: t, weight: 1 }] : [];
}

/** One SOCRA_USAGE row per (session, topic). Non-scoring context evidence. */
export async function handleSocraResponseCompleted(
  tx: DbOrTx,
  event: EventEnvelope,
): Promise<void> {
  if (!validMetadata(event) || !event.actorId || !event.courseId || !event.sessionId) return;
  const topics = await topicsForSocraEvent(tx, event);
  for (const t of topics) {
    await recordEvidence(tx, {
      userId: event.actorId,
      courseId: event.courseId,
      topicId: t.topicId,
      evidenceType: "SOCRA_USAGE",
      sourceType: "SOCRA_SESSION",
      sourceId: event.sessionId,
      value: 1,
      rawValue: { mode: event.metadata.mode },
      occurredAt: new Date(event.occurredAt),
      idempotencyKey: `socra:${event.sessionId}:${t.topicId}:SOCRA_USAGE`,
      assignmentId: event.assignmentId,
      assignmentVersion: event.assignmentVersion,
      questionId: event.questionId,
      aiSessionId: event.sessionId,
      assisted: true,
      researchCondition: event.researchCondition,
      sourceEventId: event.eventId,
      emitEvent: false,
    });
  }
}

/** One INTERVENTION_DEPTH row per assistant message (value = level / 6). Non-scoring context evidence. */
export async function handleInterventionLevelAssigned(
  tx: DbOrTx,
  event: EventEnvelope,
): Promise<void> {
  if (!validMetadata(event) || !event.actorId || !event.courseId) return;
  const m = event.metadata as { messageId: string; level: number; maxLevelInSession: number };
  const topics = await topicsForSocraEvent(tx, event);
  for (const t of topics) {
    await recordEvidence(tx, {
      userId: event.actorId,
      courseId: event.courseId,
      topicId: t.topicId,
      evidenceType: "INTERVENTION_DEPTH",
      sourceType: "SOCRA_SESSION",
      sourceId: m.messageId,
      value: m.level / 6,
      rawValue: { level: m.level, maxLevelInSession: m.maxLevelInSession },
      occurredAt: new Date(event.occurredAt),
      idempotencyKey: `socra:${m.messageId}:${t.topicId}:INTERVENTION_DEPTH`,
      assignmentId: event.assignmentId,
      assignmentVersion: event.assignmentVersion,
      questionId: event.questionId,
      aiSessionId: event.sessionId,
      assisted: m.level > 0,
      maxInterventionLevel: m.level,
      researchCondition: event.researchCondition,
      sourceEventId: event.eventId,
      emitEvent: false,
    });
  }
}

/** Approved (canonical) misconception observations become MISCONCEPTION_OBSERVED evidence. */
export async function ingestMisconceptionObservation(
  tx: DbOrTx,
  observationId: string,
  sourceEventId: string | null,
): Promise<boolean> {
  const obs = await tx.misconceptionObservation.findUnique({
    where: { id: observationId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      topicId: true,
      assignmentId: true,
      questionId: true,
      aiSessionId: true,
      confidence: true,
      detectionVersion: true,
      modelVersion: true,
      observedAt: true,
      misconception: { select: { id: true, key: true, label: true, reviewStatus: true } },
    },
  });
  if (!obs) return false;
  // Candidates (PENDING/REJECTED labels) never become learner evidence.
  if (obs.misconception.reviewStatus !== "APPROVED") return false;
  await recordEvidence(tx, {
    userId: obs.userId,
    courseId: obs.courseId,
    topicId: obs.topicId,
    evidenceType: "MISCONCEPTION_OBSERVED",
    sourceType: "MISCONCEPTION_DETECTOR",
    sourceId: obs.id,
    value: 1,
    confidence: obs.confidence,
    rawValue: {
      misconceptionId: obs.misconception.id,
      key: obs.misconception.key,
      label: obs.misconception.label,
    },
    occurredAt: obs.observedAt,
    idempotencyKey: `misc:${obs.id}:${obs.topicId}`,
    assignmentId: obs.assignmentId,
    questionId: obs.questionId,
    aiSessionId: obs.aiSessionId,
    detectorVersion: obs.detectionVersion,
    modelVersion: obs.modelVersion,
    sourceEventId,
  });
  await recomputeTopicStatesTx(tx, obs.userId, obs.courseId, { topicIds: [obs.topicId] });
  return true;
}

export async function handleMisconceptionObserved(tx: DbOrTx, event: EventEnvelope): Promise<void> {
  if (!validMetadata(event)) return;
  await ingestMisconceptionObservation(tx, String(event.metadata.observationId), event.eventId);
}
