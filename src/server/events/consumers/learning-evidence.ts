import "server-only";
import {
  handleInterventionLevelAssigned,
  handleMisconceptionObserved,
  handlePracticeAnswered,
  handleSocraResponseCompleted,
  handleSubmissionEvent,
} from "@/server/domain/learner/ingest";
import { registerConsumer } from "./registry";

/**
 * Learning-evidence consumers (Agent D). Each is transactional: the ProcessedEvent ledger row, the evidence rows,
 * the recomputed LearnerTopicState rows and any learner_topic_state_changed events commit atomically.
 * Consumer names are part of the idempotency key; never rename them.
 */
export function registerLearningConsumers(): void {
  registerConsumer({
    name: "learning-evidence.submission",
    events: ["submission_completed", "deterministic_grade_completed", "faculty_grade_finalized"],
    handle: (event, tx) => handleSubmissionEvent(tx, event),
  });
  registerConsumer({
    name: "learning-evidence.practice",
    events: ["practice_answered"],
    handle: (event, tx) => handlePracticeAnswered(tx, event),
  });
  registerConsumer({
    name: "learning-evidence.socra-usage",
    events: ["socra_response_completed"],
    handle: (event, tx) => handleSocraResponseCompleted(tx, event),
  });
  registerConsumer({
    name: "learning-evidence.intervention",
    events: ["intervention_level_assigned"],
    handle: (event, tx) => handleInterventionLevelAssigned(tx, event),
  });
  registerConsumer({
    name: "learning-evidence.misconception",
    events: ["misconception_observed"],
    handle: (event, tx) => handleMisconceptionObserved(tx, event),
  });
}

registerLearningConsumers();
