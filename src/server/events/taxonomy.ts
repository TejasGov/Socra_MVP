import { z } from "zod";
import type { PrivacyClass } from "@/generated/prisma/enums";

/**
 * Event taxonomy (TASK §20, PRD §24, data-pipelines Appendix A). Names are snake_case.
 *
 * Every event declares:
 *  - family:        grouping for dashboards/docs
 *  - privacyClass:  stored on the AnalyticsEvent row
 *  - requiresAssignmentVersion: when the event carries an assignmentId it MUST also carry assignmentVersion,
 *                   otherwise it is QUARANTINED (data-pipelines §1.14) and never dispatched.
 *  - metadata:      zod schema for the event-specific payload (loose: extra keys allowed, but see FORBIDDEN_METADATA_KEYS)
 *
 * No keystroke logging. Metadata never contains raw code, raw chat text, hidden tests, secrets or tokens.
 */

const id = z.string().min(1);
const optId = id.optional();
const level = z.number().int().min(0).max(6);
const tokenUsage = z.object({
  inputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0).optional(),
});
const aiMode = z.enum([
  "PROTECTED_ASSESSMENT",
  "PRACTICE",
  "POST_ASSESSMENT_REVIEW",
  "FACULTY_AUTHORING",
  "FACULTY_ANALYTICS",
]);
const runStatus = z.enum([
  "OK",
  "COMPILE_ERROR",
  "RUNTIME_ERROR",
  "TIMEOUT",
  "MEMORY_LIMIT",
  "OUTPUT_LIMIT",
  "RUNNER_UNAVAILABLE",
  "INTERNAL_ERROR",
]);
const language = z.enum(["PYTHON", "JAVASCRIPT", "SCALA"]);
const publicTestSummary = z.object({
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
});
const empty = z.looseObject({});

interface EventDef {
  family:
    | "navigation"
    | "work"
    | "socra"
    | "assignment"
    | "grading"
    | "practice"
    | "learning"
    | "faculty"
    | "research";
  privacyClass: PrivacyClass;
  requiresAssignmentVersion: boolean;
  schemaVersion: number;
  metadata: z.ZodType<Record<string, unknown>>;
  description: string;
}

const def = (d: EventDef) => d;

export const EVENTS = {
  // Navigation
  course_opened: def({
    family: "navigation",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: empty,
    description: "Student or staff opened a course overview.",
  }),
  assignment_opened: def({
    family: "navigation",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ mode: z.enum(["PROTECTED", "REVIEW", "PREVIEW"]).optional() }),
    description: "Assignment workspace opened.",
  }),
  question_viewed: def({
    family: "navigation",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: empty,
    description: "Question displayed in the workspace.",
  }),

  // Work
  draft_saved: def({
    family: "work",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      draftVersion: z.number().int().min(1),
      contentHash: z.string(),
      byteCount: z.number().int().min(0),
    }),
    description: "Autosave persisted a draft (hash and size only).",
  }),
  answer_changed: def({
    family: "work",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ draftVersion: z.number().int().min(1), contentHash: z.string() }),
    description: "Answer meaningfully changed after a run or Socra turn (not per keystroke).",
  }),
  code_run_requested: def({
    family: "work",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      runId: id,
      kind: z.enum(["RUN", "PUBLIC_TESTS", "GRADING"]),
      language,
      codeHash: z.string(),
    }),
    description: "Run or public tests requested.",
  }),
  code_run_completed: def({
    family: "work",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      runId: id,
      kind: z.enum(["RUN", "PUBLIC_TESTS", "GRADING"]),
      language,
      status: runStatus,
      durationMs: z.number().int().min(0).optional(),
      publicTestSummary: publicTestSummary.optional(),
      errorClass: z.string().optional(),
    }),
    description: "Run finished (status, duration, public test summary).",
  }),

  // Socra
  socra_session_started: def({
    family: "socra",
    privacyClass: "SENSITIVE_CONVERSATION",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ mode: aiMode, policyVersion: z.number().int().optional() }),
    description: "Socra session created.",
  }),
  socra_prompt_sent: def({
    family: "socra",
    privacyClass: "SENSITIVE_CONVERSATION",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ mode: aiMode, messageId: id, turnNumber: z.number().int().min(1) }),
    description: "Student sent a Socra turn (message id only, never text).",
  }),
  socra_response_completed: def({
    family: "socra",
    privacyClass: "SENSITIVE_CONVERSATION",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      mode: aiMode,
      messageId: id,
      aiRequestId: id,
      model: z.string(),
      promptVersion: z.string(),
      policyVersion: z.string().optional(),
      interventionLevel: level.optional(),
      latencyMs: z.number().int().min(0),
      tokenUsage,
      policyOutcome: z.enum(["ALLOW", "REVISE", "BLOCK", "ESCALATE"]).optional(),
      retrievedResourceIds: z.array(z.string()).optional(),
    }),
    description: "Socra response delivered.",
  }),
  socra_response_failed: def({
    family: "socra",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ mode: aiMode, aiRequestId: optId, errorClass: z.string() }),
    description: "Socra response failed (error class only).",
  }),
  intervention_level_assigned: def({
    family: "socra",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ messageId: id, level, maxLevelInSession: level }),
    description: "Intervention level (L0..L6) assigned to a Socra response.",
  }),
  course_resource_retrieved: def({
    family: "socra",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      resourceId: id,
      chunkId: optId,
      rank: z.number().int().min(0),
      method: z.enum(["VECTOR", "FULL_TEXT", "KEYWORD", "HYBRID"]),
      retrievalModelVersion: z.string().optional(),
    }),
    description: "Course resource chunk retrieved into AI context.",
  }),
  socra_limit_reached: def({
    family: "socra",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      limit: z.enum(["session_turns", "daily_turns", "course_budget", "kill_switch", "rate_limit"]),
    }),
    description: "A Socra usage limit was hit.",
  }),
  socra_escalated: def({
    family: "socra",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({ escalationId: id }),
    description: "L6 escalation to course staff.",
  }),

  // Assignment / submission
  submission_started: def({
    family: "assignment",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ attemptNumber: z.number().int().min(1) }),
    description: "Student initiated a submission.",
  }),
  submission_completed: def({
    family: "assignment",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      submissionId: id,
      attemptNumber: z.number().int().min(1),
      snapshotHash: z.string(),
      isLate: z.boolean().optional(),
    }),
    description: "Immutable submission snapshot stored.",
  }),
  submission_failed: def({
    family: "assignment",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ reason: z.string() }),
    description: "Submission rejected or failed.",
  }),
  assignment_created: def({
    family: "faculty",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      format: z.enum(["CODING", "WRITTEN", "QUIZ"]),
      aiGenerated: z.boolean().optional(),
    }),
    description: "Assignment draft created.",
  }),
  assignment_ai_generated: def({
    family: "faculty",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({ suggestionId: id, kind: z.string(), aiRequestId: optId }),
    description: "AI authoring suggestion produced (pending faculty review).",
  }),
  assignment_published: def({
    family: "faculty",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ versionId: id }),
    description: "Assignment version published (PUBLISHED_PROTECTED or SCHEDULED).",
  }),
  assignment_closed: def({
    family: "assignment",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ trigger: z.enum(["schedule", "faculty", "admin"]) }),
    description: "Assignment closed.",
  }),
  assignment_reopened: def({
    family: "assignment",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ reason: z.string().optional() }),
    description: "Assignment reopened (privileged).",
  }),
  solutions_released: def({
    family: "assignment",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: empty,
    description: "Reference solutions released for post-assessment review.",
  }),

  // Grading
  deterministic_grade_completed: def({
    family: "grading",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      submissionId: id,
      score: z.number(),
      maxScore: z.number(),
      testsPassed: z.number().int().min(0),
      testsTotal: z.number().int().min(0),
    }),
    description:
      "Deterministic tests graded a submission (aggregate counts only, no hidden test details).",
  }),
  ai_feedback_generated: def({
    family: "grading",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({ submissionId: id, gradeId: id, aiRequestId: optId }),
    description: "AI grading/feedback suggestion produced (never authoritative).",
  }),
  faculty_grade_finalized: def({
    family: "grading",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: true,
    schemaVersion: 1,
    metadata: z.looseObject({
      submissionId: id,
      gradeId: id,
      score: z.number(),
      maxScore: z.number(),
      rubricVersion: z.number().int().optional(),
      graderType: z.enum(["SYSTEM", "AI", "INSTRUCTOR", "TA"]),
      overridden: z.boolean().optional(),
    }),
    description: "Faculty finalized a grade.",
  }),

  // Practice
  practice_started: def({
    family: "practice",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({ practiceSessionId: id, topicId: optId }),
    description: "Practice session started.",
  }),
  practice_item_shown: def({
    family: "practice",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      practiceSessionId: id,
      itemId: id,
      difficulty: z.number().int().min(1).max(5),
      source: z.enum(["FACULTY", "CACHED_GENERATED", "LIVE_GENERATED"]),
    }),
    description: "Practice item served.",
  }),
  practice_answered: def({
    family: "practice",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      practiceSessionId: id,
      itemId: id,
      attemptId: id,
      isCorrect: z.boolean().nullable(),
      attemptNumber: z.number().int().min(1),
      assisted: z.boolean(),
    }),
    description: "Practice answer submitted.",
  }),
  explanation_requested: def({
    family: "practice",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({ practiceSessionId: optId, itemId: optId }),
    description: "Student asked for an explanation.",
  }),
  practice_completed: def({
    family: "practice",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      practiceSessionId: id,
      itemsServed: z.number().int().min(0),
      correctCount: z.number().int().min(0),
    }),
    description: "Practice session ended.",
  }),

  // Learning
  misconception_observed: def({
    family: "learning",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      observationId: id,
      misconceptionId: id,
      topicId: id,
      confidence: z.number().min(0).max(1),
      detectorVersion: z.string(),
    }),
    description: "Detector emitted a probabilistic misconception observation.",
  }),
  learning_evidence_recorded: def({
    family: "learning",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      evidenceId: id,
      topicId: id,
      evidenceType: z.string(),
      value: z.number().min(0).max(1),
      sourceEventIds: z.array(z.string()).optional(),
    }),
    description: "Learning evidence row appended.",
  }),
  learner_topic_state_changed: def({
    family: "learning",
    privacyClass: "EDUCATIONAL_RECORD",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      topicId: id,
      previousState: z.string().nullable(),
      newState: z.string(),
      estimatorVersion: z.string(),
    }),
    description: "Derived topic state label changed.",
  }),

  // Faculty
  analytics_viewed: def({
    family: "faculty",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      viewType: z.string(),
      scope: z.looseObject({}).optional(),
    }),
    description: "Faculty viewed an analytics surface.",
  }),
  question_insight_viewed: def({
    family: "faculty",
    privacyClass: "OPERATIONAL",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: empty,
    description: "Faculty opened a question drilldown.",
  }),

  // Research
  research_condition_assigned: def({
    family: "research",
    privacyClass: "RESEARCH_PSEUDONYMOUS",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      condition: z.enum(["CONTROL", "UNRESTRICTED_AI", "SOCRATIC_AI"]),
      method: z.string(),
    }),
    description: "Participant assigned to a study condition.",
  }),
  research_condition_changed: def({
    family: "research",
    privacyClass: "RESEARCH_PSEUDONYMOUS",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      fromCondition: z.enum(["CONTROL", "UNRESTRICTED_AI", "SOCRATIC_AI"]),
      toCondition: z.enum(["CONTROL", "UNRESTRICTED_AI", "SOCRATIC_AI"]),
    }),
    description: "Administrative condition change (audited).",
  }),
  research_export_generated: def({
    family: "research",
    privacyClass: "RESEARCH_PSEUDONYMOUS",
    requiresAssignmentVersion: false,
    schemaVersion: 1,
    metadata: z.looseObject({
      exportId: id,
      manifestId: optId,
      rowCount: z.number().int().min(0),
      checksum: z.string(),
    }),
    description: "Research export produced.",
  }),
} as const satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

/** Metadata type for an event (inferred from its zod schema). */
export type EventMetadata<N extends EventName> = z.input<(typeof EVENTS)[N]["metadata"]>;

export function isEventName(value: string): value is EventName {
  return Object.prototype.hasOwnProperty.call(EVENTS, value);
}

/**
 * Keys that must never appear (at any depth) in event metadata: raw content, secrets, hidden-test material.
 * Events violating this are quarantined.
 */
export const FORBIDDEN_METADATA_KEYS = [
  "content",
  "code",
  "codeSnapshot",
  "source",
  "message",
  "messageText",
  "prompt",
  "response",
  "text",
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "secret",
  "hiddenTests",
  "referenceSolution",
  "answerKey",
  "email",
] as const;

/** Allowed exceptions: keys whose name collides with the deny-list but whose values are enums/ids. */
const FORBIDDEN_EXCEPTIONS: Partial<Record<EventName, readonly string[]>> = {
  practice_item_shown: ["source"],
};

export function findForbiddenKeys(eventName: EventName, metadata: unknown, path = ""): string[] {
  if (metadata === null || typeof metadata !== "object") return [];
  const found: string[] = [];
  const exceptions = FORBIDDEN_EXCEPTIONS[eventName] ?? [];
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    const p = path ? `${path}.${key}` : key;
    if (
      (FORBIDDEN_METADATA_KEYS as readonly string[]).includes(key) &&
      !(path === "" && exceptions.includes(key))
    ) {
      found.push(p);
    }
    if (value && typeof value === "object") found.push(...findForbiddenKeys(eventName, value, p));
  }
  return found;
}
