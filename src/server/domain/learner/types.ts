import type {
  ConfidenceLevel,
  EvidenceSourceType,
  EvidenceType,
  StudyCondition,
  TopicStateLabel,
  Trajectory,
} from "@/generated/prisma/enums";

/** Estimator version stored on LearnerTopicState.algorithmVersion. */
export const LEARNER_MODEL_VERSION = "ltm-v1";

/** Input for `recordEvidence(tx, input)`. Append-only; idempotent on `idempotencyKey`. */
export interface RecordEvidenceInput {
  userId: string;
  courseId: string;
  topicId: string;
  evidenceType: EvidenceType;
  sourceType: EvidenceSourceType;
  /** Normalized 0..1. */
  value: number;
  occurredAt: Date;
  /** Deterministic key, e.g. `${sourceEventId}:${topicId}:${evidenceType}`. */
  idempotencyKey: string;
  sourceId?: string | null;
  assignmentId?: string | null;
  assignmentVersion?: number | null;
  questionId?: string | null;
  questionVersion?: number | null;
  practiceItemId?: string | null;
  aiSessionId?: string | null;
  rawValue?: Record<string, unknown> | null;
  assisted?: boolean;
  maxInterventionLevel?: number | null;
  difficulty?: number | null;
  attemptNumber?: number | null;
  confidence?: number;
  modelVersion?: string | null;
  detectorVersion?: string | null;
  policyVersion?: string | null;
  researchCondition?: StudyCondition | null;
  sourceEventId?: string | null;
  sourceEventIds?: string[];
  /** Emit `learning_evidence_recorded` (default true). */
  emitEvent?: boolean;
}

export interface RecordEvidenceResult {
  id: string;
  created: boolean;
}

export interface LearnerProfileTopic {
  topicId: string;
  name: string;
  state: TopicStateLabel;
  trajectory: Trajectory;
  confidence: ConfidenceLevel;
  evidenceCount: number;
  lastDemonstratedAt: string | null;
  commonDifficulty: string | null;
  suggestedAction: string;
}

export interface LearnerProfile {
  userId: string;
  courseId: string;
  algorithmVersion: string;
  topics: LearnerProfileTopic[];
}

export interface RecomputeResult {
  topicsComputed: number;
  stateChanges: number;
}
