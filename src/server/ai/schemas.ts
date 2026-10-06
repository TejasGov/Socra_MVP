import { z } from "zod";

/**
 * Structured-output schemas (zod is the source of truth; the gateway converts them to JSON Schema with
 * `z.toJSONSchema` for the OpenAI `text.format = { type: "json_schema", strict: true }` request).
 *
 * OpenAI strict mode requires every property to be required and objects closed, so these schemas use no
 * `.optional()` fields: use empty arrays / nullable instead.
 */

export const interventionLevelSchema = z.number().int().min(0).max(6);

/** PROTECTED_ASSESSMENT (and UNRESTRICTED condition) Socra turn. */
export const protectedTurnSchema = z.object({
  reply: z.string().min(1).max(6000),
  interventionLevel: interventionLevelSchema,
  citedResourceIds: z.array(z.string()).max(5),
  misconceptionCandidates: z
    .array(z.object({ label: z.string().min(1).max(120), confidence: z.number().min(0).max(1) }))
    .max(5),
});
export type ProtectedTurn = z.infer<typeof protectedTurnSchema>;

export const SCAFFOLD_STAGES = ["PREDICT", "TRACE", "COUNTEREXAMPLE", "REPAIR", "EXPLAIN", "REFLECT"] as const;

/** Question kinds the copilot may draft. TRACE is stored as SHORT_ANSWER, WRITTEN as ESSAY, CODE as CODING. */
export const DRAFT_QUESTION_TYPES = ["CODE", "MULTIPLE_CHOICE", "SHORT_ANSWER", "TRACE", "WRITTEN"] as const;
export type DraftQuestionType = (typeof DRAFT_QUESTION_TYPES)[number];

export const draftQuestionSchema = z.object({
  type: z.enum(DRAFT_QUESTION_TYPES),
  /** Short label for the question; empty lets the service derive one. */
  title: z.string(),
  prompt: z.string().min(1),
  points: z.number().min(0).max(100),
  /** MULTIPLE_CHOICE options as { id: "a".."f", text }; empty for every other type. */
  choices: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).max(8),
  /**
   * Answer key. MULTIPLE_CHOICE: the correct choice id. SHORT_ANSWER / TRACE: accepted answers joined by "||".
   * WRITTEN: key points joined by "||". CODE: empty.
   */
  answer: z.string(),
  /** Why the answer is right (and the common wrong answers wrong). Shown to students only after release. */
  explanation: z.string(),
  starterCode: z.string(),
  publicTests: z
    .array(
      z.object({
        name: z.string().min(1),
        /** JSON-encoded argument array, e.g. "[5]" (strings keep the schema strict-mode compatible). */
        argsJson: z.string(),
        /** JSON-encoded expected return value, e.g. "120". */
        expectedJson: z.string(),
      }),
    )
    .max(12),
  hiddenTestSuggestions: z
    .array(z.object({
        name: z.string().min(1),
        description: z.string(),
        argsJson: z.string(),
        expectedJson: z.string(),
      }))
    .max(12),
  rubric: z
    .array(z.object({ criterion: z.string().min(1), description: z.string(), points: z.number().min(0) }))
    .max(10),
  /** L0..L5 guidance text, in order. */
  hintLadder: z.array(z.object({ level: z.number().int().min(0).max(5), guidance: z.string().min(1) })).max(6),
  predictedMisconceptions: z
    .array(z.object({ label: z.string().min(1), description: z.string() }))
    .max(8),
});

/**
 * FACULTY_AUTHORING model output (strict-mode friendly: test values are JSON strings). The authoring-ai service
 * converts it into the API shape `AssignmentDraftSuggestion` below. Editable; never auto-published.
 */
export const assignmentDraftSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)).min(1).max(8),
  topicSlugs: z.array(z.string().min(1)).max(10),
  questions: z.array(draftQuestionSchema).min(1).max(8),
  scaffold: z
    .array(z.object({ stage: z.enum(SCAFFOLD_STAGES), instructions: z.string().min(1) }))
    .max(6),
});
export type AssignmentDraftModelOutput = z.infer<typeof assignmentDraftSuggestionSchema>;

/**
 * Test suggestion in C's TestCase storage convention (src/server/domain/assignments/test-mapping.ts):
 *   input = { kind, entryPoint?, args?, stdin? }, expected = { returns?, stdout? }
 * plus flat aliases (entryPoint, args, expectedReturn) for form mappers.
 */
export interface SuggestedTest {
  name: string;
  description?: string;
  input: { kind: "function"; entryPoint?: string; args: unknown[] };
  expected: { returns: unknown };
  entryPoint?: string;
  args: unknown[];
  expectedReturn: unknown;
}

/** Contract shape (docs/_CONTRACTS.md): AssignmentDraftSuggestion. */
export interface AssignmentDraftSuggestion {
  title: string;
  description: string;
  learningObjectives: string[];
  topicSlugs: string[];
  questions: Array<{
    title: string;
    /** Stored QuestionVersion.type. */
    type: "CODING" | "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "ESSAY";
    /** What the copilot drafted (TRACE is stored as SHORT_ANSWER). */
    kind: DraftQuestionType;
    prompt: string;
    /** MULTIPLE_CHOICE options in the seed convention [{ id, text }]; [] otherwise. */
    choices: Array<{ id: string; text: string }>;
    /** MULTIPLE_CHOICE: correct choice id; otherwise "". */
    correctChoice: string;
    /** SHORT_ANSWER/TRACE: accepted answers; ESSAY: key points; otherwise []. */
    acceptedAnswers: string[];
    explanation: string;
    entryPoint: string | null;
    points: number;
    starterCode: string;
    publicTests: SuggestedTest[];
    hiddenTestSuggestions: SuggestedTest[];
    rubric: Array<{ criterion: string; title: string; description: string; points: number; maxPoints: number }>;
    /** L0..L5 guidance text, index = level. */
    hintLadder: string[];
    predictedMisconceptions: Array<{ label: string; description: string }>;
  }>;
  scaffold: Array<{ stage: (typeof SCAFFOLD_STAGES)[number]; instructions: string }>;
}

/** Written-answer grading suggestion (never authoritative; faculty approves). */
export const writtenGradeSuggestionSchema = z.object({
  suggestedPoints: z.number().min(0),
  maxPoints: z.number().min(0),
  rationale: z.string().min(1),
  evidence: z.array(z.string()).max(10),
  feedback: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type WrittenGradeSuggestion = z.infer<typeof writtenGradeSuggestionSchema>;
