import "server-only";

/**
 * Learner model public API (contract: docs/_CONTRACTS.md, Agent D).
 *   recordEvidence(tx, input)            append LearningEvidence (idempotent on idempotencyKey)
 *   recomputeTopicStates(userId, courseId)  rebuild LearnerTopicState from evidence (emits learner_topic_state_changed on change)
 *   recomputeAllTopicStates()            rebuild every (user, course) pair that has evidence
 *   getLearnerProfile(userId, courseId)  student-facing topic profile
 */

export { recordEvidence } from "./evidence";
export { recomputeTopicStates, recomputeAllTopicStates, recomputeTopicStatesTx } from "./recompute";
export { getLearnerProfile } from "./profile";
export { computeTopicState, evidenceWeight, LTM_PARAMS } from "./topic-state";
export * from "./types";
