/**
 * AI gateway contracts (TASK §10–12, PRD §17, Appendix C).
 *
 * Implementations:
 *   src/server/ai/providers/mock.ts    MockAiProvider   (deterministic, used when AI_MOCK_MODE)
 *   src/server/ai/providers/openai.ts  OpenAiProvider   (OpenAI Responses API, store:false)
 *   src/server/ai/gateway.ts           the ONLY entry point the app uses: mode policy, context assembly, budget,
 *                                      retrieval, structured-output validation, AiRequest persistence, policy check.
 *
 * Types only (no runtime imports) so both server modules and tests can depend on them.
 */

// ---------------------------------------------------------------------------
// Modes and levels
// ---------------------------------------------------------------------------

export const AI_MODES = [
  "PROTECTED_ASSESSMENT",
  "PRACTICE",
  "POST_ASSESSMENT_REVIEW",
  "FACULTY_AUTHORING",
  "FACULTY_ANALYTICS",
] as const;

/** Strongly typed mode; each has its own policy, context rules, prompt version, logging, output handling. */
export type AiMode = (typeof AI_MODES)[number];

/** Student-facing modes (raw conversation stored in the conversation domain). */
export type StudentAiMode = Extract<
  AiMode,
  "PROTECTED_ASSESSMENT" | "PRACTICE" | "POST_ASSESSMENT_REVIEW"
>;
export type FacultyAiMode = Extract<AiMode, "FACULTY_AUTHORING" | "FACULTY_ANALYTICS">;

/**
 * Assistance intervention ladder (PRD §10.7):
 *  L0 Orientation · L1 Socratic question · L2 Conceptual hint · L3 Diagnostic localization ·
 *  L4 Related example / course reference · L5 Strong directional hint · L6 Escalation to TA/instructor
 */
export const INTERVENTION_LEVELS = [0, 1, 2, 3, 4, 5, 6] as const;
export type InterventionLevel = (typeof INTERVENTION_LEVELS)[number];

export const INTERVENTION_LEVEL_LABELS: Record<InterventionLevel, string> = {
  0: "Orientation",
  1: "Socratic question",
  2: "Conceptual hint",
  3: "Diagnostic localization",
  4: "Related example or course reference",
  5: "Strong directional hint",
  6: "Escalation to TA or instructor",
};

/** Gateway tasks (routing + cost attribution). Stored on AiRequest.task. */
export type AiTask =
  | "socratic_turn"
  | "practice_tutor_turn"
  | "practice_generation"
  | "practice_grading"
  | "review_turn"
  | "misconception_extraction"
  | "topic_classification"
  | "authoring_generation"
  | "grading_suggestion"
  | "analytics_brief"
  | "policy_check"
  | "embedding";

export type ModelTier = "protected" | "economy" | "embedding";

export type ResearchCondition = "CONTROL" | "UNRESTRICTED_AI" | "SOCRATIC_AI";

// ---------------------------------------------------------------------------
// Request envelope
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  /** Assistant turns: level assigned when produced. */
  interventionLevel?: InterventionLevel;
  createdAt?: string;
}

/** Sanitized workspace snapshot the gateway attaches automatically (student never pastes code). */
export interface WorkspaceContext {
  language: "PYTHON" | "JAVASCRIPT" | "SCALA" | null;
  /** Current editor content (code or written answer). */
  code: string;
  draftVersion?: number;
  /** Which question/file the student is focused on. */
  questionTitle?: string;
}

/** Latest execution result, sanitized: public tests only, never hidden/diagnostic test contents. */
export interface LatestExecutionContext {
  runId: string;
  status:
    | "OK"
    | "COMPILE_ERROR"
    | "RUNTIME_ERROR"
    | "TIMEOUT"
    | "MEMORY_LIMIT"
    | "OUTPUT_LIMIT"
    | "RUNNER_UNAVAILABLE"
    | "INTERNAL_ERROR";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  publicTests?: Array<{ name: string; passed: boolean; message?: string }>;
  /** Diagnostic test outcome categories (no inputs/expected values). */
  diagnosticSignals?: string[];
  completedAt?: string;
}

export interface RetrievedResource {
  resourceId: string;
  chunkId: string | null;
  resourceVersion: number;
  title: string;
  excerpt: string;
  score: number;
  method: "VECTOR" | "FULL_TEXT" | "KEYWORD" | "HYBRID";
}

/** Student-safe assignment context (no hidden tests, no reference solution unless mode allows it). */
export interface AssignmentContext {
  assignmentId: string;
  assignmentVersion: number;
  title: string;
  prompt: string;
  questionId?: string;
  questionVersion?: number;
  learningObjectives: string[];
  topicTags: string[];
  format: "CODING" | "WRITTEN" | "QUIZ";
  /** POST_ASSESSMENT_REVIEW only, after release. */
  referenceSolution?: string;
  starterCode?: string;
}

/** Socra policy in force (SocraPolicyVersion), resolved by the gateway. */
export interface PolicyContext {
  policyId: string;
  policyVersion: number;
  maxInterventionLevel: InterventionLevel;
  allowDirectSyntaxHelp: boolean;
  hintLadder: Array<{ level: InterventionLevel; guidance: string }>;
  allowedBehaviors: string[];
  forbiddenBehaviors: string[];
}

/**
 * Every AI request carries (TASK §12): mode, userId, courseId, assignmentId, questionId, sessionId,
 * researchCondition, promptVersion, policyVersion, workspace, latestExecution, retrievedResources, conversation.
 */
export interface AiRequestEnvelope {
  mode: AiMode;
  task: AiTask;
  /** Correlates AiRequest, PolicyDecision, events and logs. */
  traceId: string;
  userId: string;
  courseId: string;
  assignmentId: string | null;
  questionId: string | null;
  /** AiSession id (student modes) or null (one-shot faculty tasks). */
  sessionId: string | null;
  researchCondition: ResearchCondition | null;
  promptTemplateId: string;
  promptVersion: string;
  /** SocraPolicyVersion.version as string, or a mode policy id for non-assignment modes. */
  policyVersion: string | null;
  assignmentVersion: number | null;
  questionVersion: number | null;
  assignment: AssignmentContext | null;
  policy: PolicyContext | null;
  workspace: WorkspaceContext | null;
  latestExecution: LatestExecutionContext | null;
  retrievalScope: { courseId: string; allowedResourceIds: string[] | "ALL_COURSE" | "NONE" };
  retrievedResources: RetrievedResource[];
  conversation: ConversationTurn[];
  /** Latest user message (also the last conversation turn for chat tasks). */
  userMessage: string;
  /** PRACTICE only: learner topic states may be used (never in PROTECTED_ASSESSMENT). */
  learnerContext?: { topicStates: Array<{ topic: string; state: string }> } | null;
  /** FACULTY_ANALYTICS only: the exact computed metrics payload. The model must not compute new numbers. */
  analyticsPayload?: Record<string, unknown> | null;
  /** FACULTY_AUTHORING input. */
  authoringInput?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Provider request / result
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

/** JSON-schema structured output request (zod -> JSON schema in the gateway). */
export interface StructuredOutputSpec {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

/** What the gateway hands a provider after building prompts. */
export interface ProviderRequest {
  envelope: AiRequestEnvelope;
  model: string;
  tier: ModelTier;
  /** Stable prefix first (system + assignment/course context) for prompt caching; changing turns last. */
  messages: ProviderMessage[];
  maxOutputTokens: number;
  temperature?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  structuredOutput?: StructuredOutputSpec;
  timeoutMs: number;
  /** Abort when the client disconnects. */
  signal?: AbortSignal;
}

export interface AiUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Count only (never content). */
  reasoningTokens: number;
}

export interface AiResult {
  text: string;
  /** Parsed structured output (unvalidated: the gateway validates with zod before trusting it). */
  structured?: unknown;
  usage: AiUsage;
  /** Exact model id/snapshot reported by the provider. */
  model: string;
  provider: "MOCK" | "OPENAI";
  providerRequestId: string | null;
  latencyMs: number;
  finishReason?: "stop" | "length" | "content_filter" | "other";
  /** Set by the gateway once the AiRequest row is persisted (additive, Agent A). */
  aiRequestId?: string;
}

export type AiStreamChunk =
  | { type: "delta"; text: string }
  | { type: "done"; result: AiResult }
  | { type: "error"; error: AiErrorInfo };

export interface EmbedOptions {
  model: string;
  /** Used for AiRequest attribution. */
  envelope?: Pick<AiRequestEnvelope, "userId" | "courseId" | "traceId">;
  signal?: AbortSignal;
}

/** Provider abstraction: MockAiProvider and OpenAiProvider implement this. */
export interface AiProvider {
  readonly name: "MOCK" | "OPENAI";
  generate(req: ProviderRequest): Promise<AiResult>;
  stream(req: ProviderRequest): AsyncIterable<AiStreamChunk>;
  embed(texts: string[], opts: EmbedOptions): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mirrors the AiErrorClass Prisma enum. */
export const AI_ERROR_CLASSES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "AUTH",
  "PROVIDER_UNAVAILABLE",
  "INVALID_REQUEST",
  "CONTENT_FILTER",
  "SCHEMA_VALIDATION",
  "BUDGET_EXCEEDED",
  "KILL_SWITCH",
  "NOT_CONFIGURED",
  "UNKNOWN",
] as const;
export type AiErrorClass = (typeof AI_ERROR_CLASSES)[number];

export interface AiErrorInfo {
  errorClass: AiErrorClass;
  message: string;
  retryable: boolean;
  /** Safe message for students (never provider internals). */
  userMessage: string;
}

export class AiProviderError extends Error implements AiErrorInfo {
  constructor(
    readonly errorClass: AiErrorClass,
    message: string,
    readonly retryable: boolean,
    readonly userMessage: string = "Socra is unavailable right now. Your work is saved; you can keep editing, running and submitting.",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Embedding dimension of ResourceChunk.embedding / PracticeItem.embedding (vector(1536)). */
export const EMBEDDING_DIMENSIONS = 1536;
