import { z } from "zod";

/**
 * Authoring input (TASK §23, PRD §14.2). Shared by the API routes and the faculty form (types only on the client).
 * This file has no server-only imports so client components can import its types and constants.
 */

export const LANGUAGES = ["PYTHON", "JAVASCRIPT", "SCALA"] as const;
export const FORMATS = ["CODING", "WRITTEN", "QUIZ"] as const;
export const QUESTION_TYPES = ["CODING", "SHORT_ANSWER", "ESSAY", "MULTIPLE_CHOICE"] as const;
export const SOLUTION_RELEASE_MODES = ["NEVER", "ON_CLOSE", "MANUAL"] as const;
export const RESOURCE_SCOPES = ["ALL_COURSE_RESOURCES", "SELECTED_RESOURCES", "NONE"] as const;
export const SCAFFOLD_STAGES = [
  "Predict",
  "Trace",
  "Counterexample",
  "Repair",
  "Explain",
  "Reflect",
] as const;

export const HINT_LEVELS = [0, 1, 2, 3, 4, 5] as const;

/** Default hint ladder L0-L5 (L6 is escalation, handled by policy.escalationMessage). */
export const DEFAULT_HINT_LADDER: Array<{ level: number; guidance: string }> = [
  {
    level: 0,
    guidance:
      "Orient the student: restate what the task asks and where to start. Do not hint at the solution.",
  },
  {
    level: 1,
    guidance:
      "Ask one Socratic question that makes the student examine their own code or reasoning.",
  },
  {
    level: 2,
    guidance:
      "Name the relevant concept and explain it in general terms, without applying it to this solution.",
  },
  {
    level: 3,
    guidance:
      "Point to the region of the code or the step in the reasoning where the problem is, without fixing it.",
  },
  {
    level: 4,
    guidance:
      "Offer a related example or a pointer to a course resource that shows the idea on a different problem.",
  },
  {
    level: 5,
    guidance:
      "Give a strong directional hint about the approach. Never write the target function or the central algorithm.",
  },
];

export const DEFAULT_FORBIDDEN_BEHAVIORS = [
  "Reveal hidden tests",
  "Provide the complete solution",
  "Rewrite the target function",
  "Supply the central missing algorithm",
  "Automatically fix the student's solution",
  "Reconstruct the answer through sequential instructions",
];

export const DEFAULT_ALLOWED_BEHAVIORS = [
  "Inspect the student's code and run results",
  "Explain syntax and runtime errors",
  "Point to a suspicious line",
  "Explain a computer science concept",
  "Ask the student to trace through a case",
  "Give analogous examples",
  "Retrieve course material",
];

const nonEmpty = z.string().trim().min(1);

export const testInputSchema = z.object({
  id: z.string().optional(),
  name: nonEmpty.max(200),
  visibility: z.enum(["PUBLIC", "HIDDEN", "DIAGNOSTIC"]),
  weight: z.number().min(0).max(1000).default(1),
  kind: z.enum(["function", "stdio"]).default("function"),
  entryPoint: z.string().max(200).optional(),
  /** function tests: positional arguments (JSON). */
  args: z.array(z.unknown()).optional(),
  /** function tests: expected return value (JSON). */
  expectedReturn: z.unknown().optional(),
  stdin: z.string().max(100_000).optional(),
  expectedStdout: z.string().max(100_000).optional(),
  comparator: z.enum(["exact", "float", "normalized_whitespace"]).optional(),
  tolerance: z.number().min(0).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
  failureHint: z.string().max(500).optional(),
});
export type TestInput = z.infer<typeof testInputSchema>;

export const rubricCriterionInputSchema = z.object({
  id: z.string().optional(),
  title: nonEmpty.max(200),
  description: z.string().max(2000).default(""),
  maxPoints: z.number().min(0).max(1000),
});
export type RubricCriterionInput = z.infer<typeof rubricCriterionInputSchema>;

export const scaffoldInputSchema = z.object({
  title: nonEmpty.max(200),
  instructions: nonEmpty.max(4000),
  hint: z.string().max(2000).optional(),
});
export type ScaffoldInput = z.infer<typeof scaffoldInputSchema>;

export const questionInputSchema = z.object({
  id: z.string().optional(),
  title: nonEmpty.max(200),
  prompt: nonEmpty.max(20_000),
  type: z.enum(QUESTION_TYPES),
  points: z.number().min(0).max(10_000),
  language: z.enum(LANGUAGES).nullish(),
  starterCode: z.string().max(100_000).nullish(),
  entryPoint: z.string().max(200).nullish(),
  /** SERVER-ONLY. */
  referenceSolution: z.string().max(100_000).nullish(),
  choices: z.array(z.string().max(500)).max(12).nullish(),
  answerKey: z.unknown().optional(),
  difficulty: z.number().int().min(1).max(5).default(2),
  topicKeys: z.array(z.string()).max(20).default([]),
  tests: z.array(testInputSchema).max(60).default([]),
  rubric: z.array(rubricCriterionInputSchema).max(20).default([]),
  scaffold: z.array(scaffoldInputSchema).max(10).default([]),
});
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const policyInputSchema = z.object({
  name: z.string().max(200).optional(),
  maxInterventionLevel: z.number().int().min(0).max(6).default(5),
  hintLadder: z
    .array(z.object({ level: z.number().int().min(0).max(6), guidance: z.string().max(1000) }))
    .max(7)
    .default(DEFAULT_HINT_LADDER),
  allowedBehaviors: z.array(z.string().max(300)).max(30).default(DEFAULT_ALLOWED_BEHAVIORS),
  forbiddenBehaviors: z.array(z.string().max(300)).max(30).default(DEFAULT_FORBIDDEN_BEHAVIORS),
  allowDirectSyntaxHelp: z.boolean().default(true),
  allowResourceRetrieval: z.boolean().default(true),
  /** Assistance budget. null = environment default. */
  maxTurnsPerSession: z.number().int().min(1).max(500).nullish(),
  maxTurnsPerDay: z.number().int().min(1).max(2000).nullish(),
  escalationMessage: z.string().max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type PolicyInput = z.infer<typeof policyInputSchema>;

const dateInput = z
  .union([z.string().datetime({ offset: true }), z.string().length(0), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? new Date(v) : null));

export const assignmentInputSchema = z.object({
  courseId: nonEmpty,
  title: nonEmpty.max(200),
  description: z.string().max(20_000).default(""),
  format: z.enum(FORMATS),
  language: z.enum(LANGUAGES).nullish(),
  openAt: dateInput,
  dueAt: dateInput,
  closeAt: dateInput,
  attemptLimit: z.number().int().min(1).max(100).nullish(),
  allowResubmission: z.boolean().default(true),
  solutionReleaseMode: z.enum(SOLUTION_RELEASE_MODES).default("MANUAL"),
  resourceScope: z.enum(RESOURCE_SCOPES).default("ALL_COURSE_RESOURCES"),
  resourceIds: z.array(z.string()).max(200).default([]),
  learningObjectives: z.array(nonEmpty.max(500)).max(20).default([]),
  topicKeys: z.array(z.string()).max(30).default([]),
  questions: z.array(questionInputSchema).max(30).default([]),
  policy: policyInputSchema.default(() => policyInputSchema.parse({})),
  /** Set when the form was filled from a copilot suggestion (emits assignment_ai_generated). */
  aiSuggestionId: z.string().optional(),
});
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
/** Raw (pre-parse) shape used by clients building the payload. */
export type AssignmentInputRaw = z.input<typeof assignmentInputSchema>;

/** Fields editable after publish (dates, attempts and release settings only). */
export const assignmentScheduleUpdateSchema = z.object({
  openAt: dateInput,
  dueAt: dateInput,
  closeAt: dateInput,
  attemptLimit: z.number().int().min(1).max(100).nullish(),
  allowResubmission: z.boolean().optional(),
  solutionReleaseMode: z.enum(SOLUTION_RELEASE_MODES).optional(),
});
