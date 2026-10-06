import type {
  ProgrammingLanguage,
  QuestionType,
  AssignmentFormat,
  AssignmentState,
} from "@/generated/prisma/enums";
import type { TestSpec } from "@/server/runner/types";

export type SeedTest = TestSpec & { visibility: "PUBLIC" | "HIDDEN" };

export interface VariantDef {
  key: string;
  label: string;
  code: string;
  /** ids of tests (public or hidden) this variant fails. */
  failing: string[];
  /** stdout of a plain RUN of this code (what a student would typically see). */
  out: string;
  err?: { status: "RUNTIME_ERROR" | "TIMEOUT" | "COMPILE_ERROR"; text: string };
  /** Misconception key (course scoped) a rule-based detector would flag. */
  misconception?: string;
}

export interface QuestionDef {
  key: string;
  title: string;
  prompt: string;
  type: QuestionType;
  points: number;
  language: ProgrammingLanguage | null;
  entryPoint?: string;
  starterCode?: string;
  reference?: string;
  tests: SeedTest[];
  variants: VariantDef[];
  topics: Array<{ key: string; weight: number }>;
  rubric: Array<{ title: string; description: string; maxPoints: number }>;
  difficulty: number;
  hints: string[];
  scaffold: Array<{ stage: string; instructions: string; hint?: string }>;
  choices?: Array<{ id: string; text: string }>;
  answerKey?: Record<string, unknown>;
}

export interface AssignmentDef {
  key: string;
  courseKey: "cse115" | "cse116";
  title: string;
  description: string;
  format: AssignmentFormat;
  language: ProgrammingLanguage;
  state: AssignmentState;
  /** Day offsets relative to the seed anchor (negative = past). */
  openDay: number | null;
  dueDay: number | null;
  closed?: boolean;
  solutionsReleased?: boolean;
  attemptLimit: number | null;
  objectives: string[];
  /** Fraction of enrolled students who start / submit (simulation input). */
  startRate: number;
  submitRate: number;
  /** Max Socra intervention level the assignment policy allows (0..6). */
  policyMaxLevel: number;
  questions: QuestionDef[];
}
