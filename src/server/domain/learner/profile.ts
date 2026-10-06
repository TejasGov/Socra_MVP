import "server-only";
import { prisma } from "@/server/db";
import { suggestedActionFor } from "./topic-state";
import { LEARNER_MODEL_VERSION, type LearnerProfile } from "./types";

const STATE_ORDER = {
  NEEDS_REINFORCEMENT: 0,
  DEVELOPING: 1,
  CONSISTENTLY_DEMONSTRATED: 2,
} as const;

/**
 * Student-facing learning profile for one course. Only topics with evidence appear (no evidence => no claim).
 * Authorization is the caller's job (the API route allows the owner only).
 */
export async function getLearnerProfile(userId: string, courseId: string): Promise<LearnerProfile> {
  const states = await prisma.learnerTopicState.findMany({
    where: { userId, courseId },
    select: {
      topicId: true,
      state: true,
      trajectory: true,
      confidence: true,
      evidenceCount: true,
      lastDemonstratedAt: true,
      commonDifficulty: true,
      algorithmVersion: true,
      topic: { select: { name: true, order: true } },
    },
  });
  states.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.topic.order - b.topic.order ||
      a.topic.name.localeCompare(b.topic.name),
  );
  return {
    userId,
    courseId,
    algorithmVersion: states[0]?.algorithmVersion ?? LEARNER_MODEL_VERSION,
    topics: states.map((s) => ({
      topicId: s.topicId,
      name: s.topic.name,
      state: s.state,
      trajectory: s.trajectory,
      confidence: s.confidence,
      evidenceCount: s.evidenceCount,
      lastDemonstratedAt: s.lastDemonstratedAt?.toISOString() ?? null,
      commonDifficulty: s.commonDifficulty,
      suggestedAction: suggestedActionFor(s.state, s.topic.name, s.commonDifficulty),
    })),
  };
}
