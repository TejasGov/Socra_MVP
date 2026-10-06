import type { EvidenceSourceType, EvidenceType, StudyCondition } from "@/generated/prisma/enums";
import { sid } from "./context";
import { type Acc, type CourseKey, type Student } from "./sim";
import { S } from "./state";

export interface EvidenceInput {
  acc: Acc;
  st: Student;
  courseKey: CourseKey;
  courseId: string;
  topicId: string;
  /** Unique within (student, source) so replays are no-ops. */
  key: string;
  type: EvidenceType;
  sourceType: EvidenceSourceType;
  sourceId: string | null;
  sourceEventId: string | null;
  value: number;
  raw?: Record<string, unknown>;
  weight?: number;
  assisted?: boolean;
  maxLevel?: number | null;
  difficulty?: number | null;
  attemptNumber?: number | null;
  assignmentId?: string | null;
  assignmentVersion?: number | null;
  questionId?: string | null;
  practiceItemId?: string | null;
  aiSessionId?: string | null;
  at: Date;
  detectorVersion?: string | null;
  confidence?: number;
  condition: StudyCondition | null;
}

/** Appends a LearningEvidence row (shape documented in schema.prisma) plus its learning_evidence_recorded event. */
export function addEvidence(e: EvidenceInput): void {
  const idempotencyKey = `seed:${e.st.key}:${e.key}:${e.topicId}:${e.type}`;
  const id = sid("ev", e.st.key, e.key, e.topicId, e.type);
  const value = Math.round(Math.min(1, Math.max(0, e.value)) * 1000) / 1000;
  const sectionId = e.st.section[e.courseKey]
    ? sid("section", e.courseKey, e.st.section[e.courseKey] as string)
    : null;
  e.acc.evidence.push({
    id,
    userId: e.st.id,
    courseId: e.courseId,
    topicId: e.topicId,
    assignmentId: e.assignmentId ?? null,
    assignmentVersion: e.assignmentVersion ?? null,
    questionId: e.questionId ?? null,
    questionVersion: e.questionId ? 1 : null,
    practiceItemId: e.practiceItemId ?? null,
    aiSessionId: e.aiSessionId ?? null,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    evidenceType: e.type,
    value,
    rawValue: e.raw ?? null,
    weight: e.weight ?? 1,
    assisted: e.assisted ?? false,
    maxInterventionLevel: e.maxLevel ?? null,
    difficulty: e.difficulty ?? null,
    attemptNumber: e.attemptNumber ?? null,
    confidence: e.confidence ?? 1,
    modelVersion: null,
    detectorVersion: e.detectorVersion ?? null,
    policyVersion: e.assisted ? "1" : null,
    researchCondition: e.condition,
    sourceEventId: e.sourceEventId,
    sourceEventIds: e.sourceEventId ? [e.sourceEventId] : [],
    idempotencyKey,
    occurredAt: e.at,
    recordedAt: new Date(e.at.getTime() + 2000),
  });
  e.acc.events.add({
    name: "learning_evidence_recorded",
    key: `evrec:${idempotencyKey}`,
    at: new Date(e.at.getTime() + 2000),
    actorId: e.st.id,
    courseId: e.courseId,
    sectionId,
    condition: e.condition,
    metadata: {
      evidenceId: id,
      topicId: e.topicId,
      evidenceType: e.type,
      value,
      sourceEventIds: e.sourceEventId ? [e.sourceEventId] : [],
    },
  });
}

export interface ObsInput {
  acc: Acc;
  st: Student;
  courseKey: CourseKey;
  courseId: string;
  misconceptionKey: string;
  key: string;
  confidence: number;
  method: "RULE" | "LLM" | "FACULTY_TAGGED";
  at: Date;
  assignmentId?: string | null;
  questionId?: string | null;
  submissionId?: string | null;
  codeRunId?: string | null;
  aiSessionId?: string | null;
  practiceAttemptId?: string | null;
  reviewStatus?: "PENDING" | "APPROVED";
  sourceEventId?: string | null;
}

/** Adds a probabilistic MisconceptionObservation, its event, and a MISCONCEPTION_OBSERVED evidence row. */
export function addObservation(
  o: ObsInput,
): { id: string; topicId: string; eventId: string } | null {
  const m = S.misconceptions.find(
    (x) => x.courseKey === o.courseKey && x.key === o.misconceptionKey,
  );
  if (!m) return null;
  const id = sid("mobs", o.st.key, o.key, o.method);
  const detectorVersion = o.method === "LLM" ? "llm-extractor-v1" : "rules-v1";
  const confidence = Math.round(o.confidence * 100) / 100;
  o.acc.obs.push({
    id,
    userId: o.st.id,
    courseId: o.courseId,
    topicId: m.topicId,
    misconceptionId: m.id,
    assignmentId: o.assignmentId ?? null,
    questionId: o.questionId ?? null,
    submissionId: o.submissionId ?? null,
    codeRunId: o.codeRunId ?? null,
    aiSessionId: o.aiSessionId ?? null,
    practiceAttemptId: o.practiceAttemptId ?? null,
    confidence,
    detectionMethod: o.method,
    detectionVersion: detectorVersion,
    modelVersion: o.method === "LLM" ? "mock-economy-1" : null,
    reviewStatus: o.reviewStatus ?? "PENDING",
    idempotencyKey: `seed:${o.st.key}:${o.key}:${o.method}`,
    observedAt: o.at,
  });
  const sectionId = o.st.section[o.courseKey]
    ? sid("section", o.courseKey, o.st.section[o.courseKey] as string)
    : null;
  const eventId = o.acc.events.add({
    name: "misconception_observed",
    key: `mobs:${o.st.key}:${o.key}:${o.method}`,
    at: o.at,
    actorId: o.st.id,
    courseId: o.courseId,
    sectionId,
    assignmentId: o.assignmentId ?? null,
    assignmentVersion: o.assignmentId
      ? (S.assignments.find((a) => a.id === o.assignmentId)?.version ?? null)
      : null,
    questionId: o.questionId ?? null,
    condition: o.st.condition,
    metadata: {
      observationId: id,
      misconceptionId: m.id,
      topicId: m.topicId,
      confidence,
      detectorVersion,
    },
  });
  addEvidence({
    acc: o.acc,
    st: o.st,
    courseKey: o.courseKey,
    courseId: o.courseId,
    topicId: m.topicId,
    key: `mobs:${o.key}:${o.method}`,
    type: "MISCONCEPTION_OBSERVED",
    sourceType: "MISCONCEPTION_DETECTOR",
    sourceId: id,
    sourceEventId: eventId,
    value: confidence,
    raw: { misconception: o.misconceptionKey, label: m.def.label },
    weight: o.method === "LLM" ? 0.5 : 0.8,
    assignmentId: o.assignmentId ?? null,
    assignmentVersion: o.assignmentId
      ? (S.assignments.find((a) => a.id === o.assignmentId)?.version ?? null)
      : null,
    questionId: o.questionId ?? null,
    aiSessionId: o.aiSessionId ?? null,
    at: new Date(o.at.getTime() + 1000),
    detectorVersion,
    confidence,
    condition: o.st.condition,
  });
  return { id, topicId: m.topicId, eventId };
}
