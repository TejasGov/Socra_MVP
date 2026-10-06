import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TopicStateLabel } from "@/generated/prisma/enums";
import { prisma, type DbOrTx } from "@/server/db";
import { writeEvent } from "@/server/events/outbox";
import { computeTopicState, type EvidenceObservation } from "./topic-state";
import type { RecomputeResult } from "./types";

/** Read a misconception label out of a MISCONCEPTION_OBSERVED rawValue. */
function labelFrom(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "label" in raw) {
    const l = (raw as { label?: unknown }).label;
    return typeof l === "string" && l.length > 0 ? l : null;
  }
  return null;
}

/** Load non-invalidated evidence for a user+course (optionally limited to topics) as model observations. */
export async function loadObservations(
  db: DbOrTx,
  userId: string,
  courseId: string,
  topicIds?: readonly string[],
): Promise<Map<string, EvidenceObservation[]>> {
  const rows = await db.learningEvidence.findMany({
    where: {
      userId,
      courseId,
      invalidatedAt: null,
      ...(topicIds ? { topicId: { in: [...topicIds] } } : {}),
    },
    select: {
      topicId: true,
      evidenceType: true,
      sourceType: true,
      value: true,
      occurredAt: true,
      assisted: true,
      maxInterventionLevel: true,
      rawValue: true,
    },
    orderBy: { occurredAt: "asc" },
  });
  const byTopic = new Map<string, EvidenceObservation[]>();
  for (const r of rows) {
    const list = byTopic.get(r.topicId) ?? [];
    list.push({
      evidenceType: r.evidenceType,
      sourceType: r.sourceType,
      value: r.value,
      occurredAt: r.occurredAt,
      assisted: r.assisted,
      maxInterventionLevel: r.maxInterventionLevel,
      misconceptionLabel:
        r.evidenceType === "MISCONCEPTION_OBSERVED" ? labelFrom(r.rawValue) : null,
    });
    byTopic.set(r.topicId, list);
  }
  return byTopic;
}

/**
 * Rebuild LearnerTopicState rows for a user+course from evidence, inside the caller's transaction.
 * Emits `learner_topic_state_changed` only when the state label changes (including first computation).
 */
export async function recomputeTopicStatesTx(
  tx: DbOrTx,
  userId: string,
  courseId: string,
  opts: { topicIds?: readonly string[]; asOf?: Date; emitEvents?: boolean } = {},
): Promise<RecomputeResult> {
  const asOf = opts.asOf ?? new Date();
  const byTopic = await loadObservations(tx, userId, courseId, opts.topicIds);
  const existing = await tx.learnerTopicState.findMany({
    where: { userId, courseId, ...(opts.topicIds ? { topicId: { in: [...opts.topicIds] } } : {}) },
    select: { topicId: true, state: true },
  });
  const previous = new Map<string, TopicStateLabel>(existing.map((s) => [s.topicId, s.state]));

  let stateChanges = 0;
  for (const [topicId, observations] of byTopic) {
    const r = computeTopicState(observations, asOf);
    const data = {
      state: r.state,
      score: r.score,
      trajectory: r.trajectory,
      evidenceCount: r.observationCount,
      confidence: r.confidence,
      confidenceScore: r.confidenceScore,
      assistanceDependency: r.assistanceDependency,
      firstAttemptRate: r.firstAttemptRate,
      lastEvidenceAt: r.lastEvidenceAt,
      lastDemonstratedAt: r.lastDemonstratedAt,
      commonDifficulty: r.commonDifficulty,
      misconceptionSummary: r.misconceptionSummary as Prisma.InputJsonValue,
      explanation: r.explanation,
      algorithmVersion: r.algorithmVersion,
      computedAsOf: asOf,
    };
    await tx.learnerTopicState.upsert({
      where: { userId_topicId: { userId, topicId } },
      create: { userId, courseId, topicId, ...data },
      update: data,
    });
    const prev = previous.get(topicId) ?? null;
    if (prev !== r.state) {
      stateChanges += 1;
      if (opts.emitEvents !== false) {
        await writeEvent(tx, {
          eventName: "learner_topic_state_changed",
          actorId: userId,
          courseId,
          occurredAt: asOf,
          idempotencyKey: `learner_topic_state_changed:${userId}:${topicId}:${prev ?? "none"}:${r.state}:${asOf.toISOString()}`,
          metadata: {
            topicId,
            previousState: prev,
            newState: r.state,
            estimatorVersion: r.algorithmVersion,
          },
        });
      }
    }
  }

  // Topics whose evidence was all invalidated: the derived state no longer has support.
  const orphaned = existing.filter((s) => !byTopic.has(s.topicId)).map((s) => s.topicId);
  if (orphaned.length > 0) {
    await tx.learnerTopicState.deleteMany({ where: { userId, topicId: { in: orphaned } } });
  }

  return { topicsComputed: byTopic.size, stateChanges };
}

/** Rebuild all topic states for one user+course (own transaction). */
export async function recomputeTopicStates(
  userId: string,
  courseId: string,
  opts: { topicIds?: readonly string[]; asOf?: Date; emitEvents?: boolean } = {},
): Promise<RecomputeResult> {
  return prisma.$transaction((tx) => recomputeTopicStatesTx(tx, userId, courseId, opts), {
    timeout: 60_000,
  });
}

/** Rebuild every (user, course) pair that has evidence. Used by seed, backfills and estimator upgrades. */
export async function recomputeAllTopicStates(
  opts: { asOf?: Date; emitEvents?: boolean } = {},
): Promise<RecomputeResult & { pairs: number }> {
  const pairs = await prisma.learningEvidence.groupBy({
    by: ["userId", "courseId"],
    where: { invalidatedAt: null },
  });
  const total = { topicsComputed: 0, stateChanges: 0, pairs: pairs.length };
  for (const p of pairs) {
    const r = await recomputeTopicStates(p.userId, p.courseId, opts);
    total.topicsComputed += r.topicsComputed;
    total.stateChanges += r.stateChanges;
  }
  return total;
}
