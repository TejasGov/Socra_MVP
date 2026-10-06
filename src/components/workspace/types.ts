/**
 * Client-side DTOs for the student assignment workspace.
 * The server page maps the domain query result (getAssignmentForStudent) into these shapes,
 * so the client never sees hidden tests, reference solutions or answer keys.
 */

export type WorkspaceLanguage = "PYTHON" | "JAVASCRIPT" | "SCALA";

export type StudentAiModeDto = "PROTECTED_ASSESSMENT" | "POST_ASSESSMENT_REVIEW";

export type QuestionKind = "CODING" | "SHORT_ANSWER" | "ESSAY" | "MULTIPLE_CHOICE";

export interface PublicTestDto {
  id: string;
  name: string;
  /** Human-readable input, e.g. `fact(3)` or the stdin text. */
  input: string;
  /** Human-readable expected value/output. */
  expected: string;
}

export interface StudentTestResultDto {
  testId: string;
  name: string;
  passed: boolean;
  actual?: string;
  expected?: string;
  message?: string;
}

export type RunStatusDto =
  | "QUEUED"
  | "RUNNING"
  | "OK"
  | "COMPILE_ERROR"
  | "RUNTIME_ERROR"
  | "TIMEOUT"
  | "MEMORY_LIMIT"
  | "OUTPUT_LIMIT"
  | "RUNNER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface StudentRunDto {
  runId: string;
  kind: "RUN" | "PUBLIC_TESTS";
  status: RunStatusDto;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  truncated: boolean;
  testResults: StudentTestResultDto[];
  completedAt: string | null;
}

export interface DraftDto {
  content: string;
  version: number;
  updatedAt: string;
}

export interface WorkspaceQuestionDto {
  id: string;
  title: string;
  /** Markdown. */
  prompt: string;
  type: QuestionKind;
  language: WorkspaceLanguage | null;
  starterCode: string;
  points: number;
  choices: Array<{ id: string; label: string }> | null;
  publicTests: PublicTestDto[];
  draft: DraftDto | null;
  latestRun: StudentRunDto | null;
}

export interface SubmissionSummaryDto {
  submissionId: string;
  attemptNumber: number;
  submittedAt: string;
  status: string;
}

export interface WorkspaceDto {
  assignmentId: string;
  courseId: string;
  courseCode: string;
  title: string;
  /** Markdown. */
  description: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  /** Assignment lifecycle state (DRAFT … ARCHIVED). */
  state: string;
  /** Per-student progress (NOT_STARTED, IN_PROGRESS, SUBMITTED, RETURNED, CLOSED). */
  progressStatus: string;
  mode: StudentAiModeDto;
  solutionsReleased: boolean;
  dueAt: string | null;
  /** Past due and not closed, computed when the page loaded. */
  overdue: boolean;
  closeAt: string | null;
  /** null = unlimited. */
  attemptLimit: number | null;
  attemptsUsed: number;
  allowResubmission: boolean;
  /** Whether the student may submit now (server decision; client uses it only for display). */
  canSubmit: boolean;
  /** When canSubmit is false: plain-language reason. */
  submitBlockedReason: string | null;
  latestSubmission: SubmissionSummaryDto | null;
  learningObjectives: string[];
  topics: string[];
  questions: WorkspaceQuestionDto[];
  /** False when the protectedSocra flag is off for this course. */
  socraAvailable: boolean;
}

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict" | "error";

export const LANGUAGE_LABELS: Record<WorkspaceLanguage, string> = {
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  SCALA: "Scala",
};

export const LANGUAGE_FILE: Record<WorkspaceLanguage, string> = {
  PYTHON: "main.py",
  JAVASCRIPT: "main.js",
  SCALA: "Main.scala",
};
