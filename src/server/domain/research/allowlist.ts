import { z } from "zod";

/**
 * Server-side registry of exportable research fields (PRD §34.4, TASK §26).
 *
 * This is the ONLY place that decides what can leave the system. A field is either listed here, or it cannot be
 * requested. Direct identifiers (name, email, user id, session id) and raw content (messages, code, answers) have no
 * entry and therefore can never be exported. Metadata is read through explicit per-field extractors, never copied
 * wholesale, so an unexpected key in event metadata cannot leak into an export.
 *
 * Row grain: interaction (one row per accepted analytics event of a consenting participant).
 * Documented field by field in docs/RESEARCH_DATA_DICTIONARY.md; keep the two in sync.
 */

export type FieldType = "string" | "integer" | "number" | "boolean" | "datetime" | "enum";

/** Input to extractors: only already-pseudonymized or non-identifying values. */
export interface ExportSource {
  participantId: string;
  condition: string | null;
  eventId: string;
  eventName: string;
  occurredAt: Date;
  courseId: string | null;
  assignmentId: string | null;
  assignmentVersion: number | null;
  questionId: string | null;
  questionVersion: number | null;
  schemaVersion: number;
  appVersion: string;
  metadata: Record<string, unknown>;
}

export type ExportValue = string | number | boolean | null;

export interface ExportFieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: "identity" | "context" | "versions" | "outcome" | "ai" | "operational";
  /** Where the value comes from (shown in the data dictionary). */
  source: string;
  privacy: string;
  extract: (row: ExportSource) => ExportValue;
}

const MAX_STRING = 120;

function str(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return v.slice(0, MAX_STRING);
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export const EXPORT_FIELDS: readonly ExportFieldDef[] = [
  {
    key: "participantId",
    label: "Participant ID",
    type: "string",
    group: "identity",
    source: "HMAC-SHA256 of the user id with RESEARCH_PSEUDONYM_SECRET (pseudonymFor)",
    privacy: "Pseudonymous. Re-identification needs the protected mapping table and is audited.",
    extract: (r) => r.participantId,
  },
  {
    key: "condition",
    label: "Study condition",
    type: "enum",
    group: "context",
    source:
      "AnalyticsEvent.researchCondition, stamped when the event was written (falls back to StudyParticipant.condition)",
    privacy: "Research variable. Changes are recorded in StudyConditionChange and the audit log.",
    extract: (r) => r.condition,
  },
  {
    key: "eventId",
    label: "Event ID",
    type: "string",
    group: "context",
    source: "AnalyticsEvent.id (random UUID)",
    privacy: "Random identifier, not derived from any person.",
    extract: (r) => r.eventId,
  },
  {
    key: "eventName",
    label: "Event name",
    type: "string",
    group: "context",
    source: "AnalyticsEvent.eventName (event taxonomy)",
    privacy: "No personal data.",
    extract: (r) => r.eventName,
  },
  {
    key: "eventTime",
    label: "Event time (UTC)",
    type: "datetime",
    group: "context",
    source: "AnalyticsEvent.occurredAt",
    privacy: "Timestamps can be quasi-identifying in small cohorts; use date-range filters.",
    extract: (r) => r.occurredAt.toISOString(),
  },
  {
    key: "courseId",
    label: "Course ID",
    type: "string",
    group: "context",
    source: "AnalyticsEvent.courseId",
    privacy: "Internal course identifier, not a person identifier.",
    extract: (r) => r.courseId,
  },
  {
    key: "assignmentId",
    label: "Assignment ID",
    type: "string",
    group: "context",
    source: "AnalyticsEvent.assignmentId",
    privacy: "Internal assignment identifier.",
    extract: (r) => r.assignmentId,
  },
  {
    key: "assignmentVersion",
    label: "Assignment version",
    type: "integer",
    group: "versions",
    source: "AnalyticsEvent.assignmentVersion",
    privacy: "No personal data.",
    extract: (r) => r.assignmentVersion,
  },
  {
    key: "questionId",
    label: "Question ID",
    type: "string",
    group: "context",
    source: "AnalyticsEvent.questionId",
    privacy: "Internal question identifier.",
    extract: (r) => r.questionId,
  },
  {
    key: "questionVersion",
    label: "Question version",
    type: "integer",
    group: "versions",
    source: "AnalyticsEvent.questionVersion",
    privacy: "No personal data.",
    extract: (r) => r.questionVersion,
  },
  {
    key: "schemaVersion",
    label: "Event schema version",
    type: "integer",
    group: "versions",
    source: "AnalyticsEvent.schemaVersion",
    privacy: "No personal data.",
    extract: (r) => r.schemaVersion,
  },
  {
    key: "appVersion",
    label: "App version",
    type: "string",
    group: "versions",
    source: "AnalyticsEvent.appVersion",
    privacy: "No personal data.",
    extract: (r) => r.appVersion,
  },
  {
    key: "aiMode",
    label: "AI mode",
    type: "enum",
    group: "ai",
    source: "event metadata.mode (Socra events)",
    privacy: "No personal data.",
    extract: (r) => str(r.metadata.mode),
  },
  {
    key: "model",
    label: "Model version",
    type: "string",
    group: "versions",
    source: "event metadata.model (socra_response_completed)",
    privacy: "No personal data.",
    extract: (r) => str(r.metadata.model),
  },
  {
    key: "promptVersion",
    label: "Prompt version",
    type: "string",
    group: "versions",
    source: "event metadata.promptVersion (socra_response_completed)",
    privacy: "No personal data. The prompt text itself is never exported.",
    extract: (r) => str(r.metadata.promptVersion),
  },
  {
    key: "policyVersion",
    label: "Socra policy version",
    type: "string",
    group: "versions",
    source: "event metadata.policyVersion",
    privacy: "No personal data.",
    extract: (r) =>
      r.metadata.policyVersion == null ? null : str(String(r.metadata.policyVersion)),
  },
  {
    key: "policyOutcome",
    label: "Policy check outcome",
    type: "enum",
    group: "ai",
    source: "event metadata.policyOutcome (ALLOW, REVISE, BLOCK, ESCALATE)",
    privacy: "No personal data.",
    extract: (r) => str(r.metadata.policyOutcome),
  },
  {
    key: "interventionLevel",
    label: "Intervention level (0-6)",
    type: "integer",
    group: "ai",
    source:
      "event metadata.interventionLevel or metadata.level (socra_response_completed, intervention_level_assigned)",
    privacy: "A level only; the message text is never exported.",
    extract: (r) => int(r.metadata.interventionLevel ?? r.metadata.level),
  },
  {
    key: "maxInterventionLevel",
    label: "Highest intervention level in session",
    type: "integer",
    group: "ai",
    source: "event metadata.maxLevelInSession (intervention_level_assigned)",
    privacy: "A level only.",
    extract: (r) => int(r.metadata.maxLevelInSession),
  },
  {
    key: "correct",
    label: "Correct",
    type: "boolean",
    group: "outcome",
    source: "event metadata.isCorrect (practice_answered); empty when not auto-gradable",
    privacy: "Learning outcome tied only to the pseudonymous participant.",
    extract: (r) => bool(r.metadata.isCorrect),
  },
  {
    key: "attemptNumber",
    label: "Attempt number",
    type: "integer",
    group: "outcome",
    source: "event metadata.attemptNumber",
    privacy: "No personal data.",
    extract: (r) => int(r.metadata.attemptNumber),
  },
  {
    key: "assisted",
    label: "Answered with assistance",
    type: "boolean",
    group: "outcome",
    source: "event metadata.assisted (practice_answered)",
    privacy: "No personal data.",
    extract: (r) => bool(r.metadata.assisted),
  },
  {
    key: "score",
    label: "Deterministic score",
    type: "number",
    group: "outcome",
    source: "event metadata.score (deterministic_grade_completed)",
    privacy: "Outcome tied only to the pseudonymous participant.",
    extract: (r) => num(r.metadata.score),
  },
  {
    key: "maxScore",
    label: "Maximum score",
    type: "number",
    group: "outcome",
    source: "event metadata.maxScore (deterministic_grade_completed)",
    privacy: "No personal data.",
    extract: (r) => num(r.metadata.maxScore),
  },
  {
    key: "testsPassed",
    label: "Tests passed",
    type: "integer",
    group: "outcome",
    source: "event metadata.testsPassed (deterministic_grade_completed)",
    privacy: "Counts only. Hidden test content is never exported.",
    extract: (r) => int(r.metadata.testsPassed),
  },
  {
    key: "testsTotal",
    label: "Tests total",
    type: "integer",
    group: "outcome",
    source: "event metadata.testsTotal (deterministic_grade_completed)",
    privacy: "Counts only.",
    extract: (r) => int(r.metadata.testsTotal),
  },
  {
    key: "topicId",
    label: "Topic ID",
    type: "string",
    group: "context",
    source: "event metadata.topicId (practice, learning evidence, misconception events)",
    privacy: "Internal topic identifier.",
    extract: (r) => str(r.metadata.topicId),
  },
  {
    key: "runStatus",
    label: "Code run status",
    type: "enum",
    group: "operational",
    source: "event metadata.status (code_run_completed)",
    privacy: "Status only; code and output are never exported.",
    extract: (r) => str(r.metadata.status),
  },
  {
    key: "latencyMs",
    label: "AI latency (ms)",
    type: "integer",
    group: "operational",
    source: "event metadata.latencyMs (socra_response_completed)",
    privacy: "No personal data.",
    extract: (r) => int(r.metadata.latencyMs),
  },
  {
    key: "inputTokens",
    label: "Input tokens",
    type: "integer",
    group: "operational",
    source: "event metadata.tokenUsage.inputTokens",
    privacy: "Counts only.",
    extract: (r) => int(obj(r.metadata.tokenUsage).inputTokens),
  },
  {
    key: "outputTokens",
    label: "Output tokens",
    type: "integer",
    group: "operational",
    source: "event metadata.tokenUsage.outputTokens",
    privacy: "Counts only.",
    extract: (r) => int(obj(r.metadata.tokenUsage).outputTokens),
  },
  {
    key: "retrievedResourceCount",
    label: "Retrieved course resources (count)",
    type: "integer",
    group: "ai",
    source: "length of event metadata.retrievedResourceIds",
    privacy: "A count only; resource ids and text are not exported.",
    extract: (r) =>
      Array.isArray(r.metadata.retrievedResourceIds)
        ? r.metadata.retrievedResourceIds.length
        : null,
  },
];

export const EXPORT_FIELD_KEYS: readonly string[] = EXPORT_FIELDS.map((f) => f.key);

/** Documented as deliberately absent. Requests naming these get a specific refusal message. */
export const FORBIDDEN_FIELD_HINTS: readonly string[] = [
  "name",
  "email",
  "userId",
  "actorId",
  "sessionId",
  "message",
  "content",
  "text",
  "code",
  "answer",
  "transcript",
  "ip",
];

export const DEFAULT_EXPORT_FIELDS: readonly string[] = [
  "participantId",
  "condition",
  "eventName",
  "eventTime",
  "courseId",
  "assignmentId",
  "assignmentVersion",
  "questionId",
  "questionVersion",
  "model",
  "promptVersion",
  "policyVersion",
  "interventionLevel",
  "correct",
  "topicId",
];

export interface FieldValidation {
  ok: boolean;
  rejected: string[];
  duplicates: string[];
}

/** Pure check used by the service and by tests. */
export function validateFields(fields: readonly string[]): FieldValidation {
  const allowed = new Set(EXPORT_FIELD_KEYS);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const rejected: string[] = [];
  for (const f of fields) {
    if (seen.has(f)) duplicates.push(f);
    seen.add(f);
    if (!allowed.has(f)) rejected.push(f);
  }
  return { ok: rejected.length === 0 && fields.length > 0, rejected, duplicates };
}

/** Selected fields in registry order (stable column order regardless of request order). */
export function orderedFields(fields: readonly string[]): ExportFieldDef[] {
  const wanted = new Set(fields);
  return EXPORT_FIELDS.filter((f) => wanted.has(f.key));
}

export function describeAllowlist() {
  return EXPORT_FIELDS.map(({ extract: _extract, ...rest }) => rest);
}

export const exportRequestSchema = z.object({
  courseId: z.string().min(1).optional(),
  assignmentId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  eventNames: z.array(z.string().min(1).max(80)).max(60).optional(),
  fields: z.array(z.string().min(1).max(60)).min(1, "Choose at least one field").max(60),
  format: z.enum(["CSV", "JSON"]),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
