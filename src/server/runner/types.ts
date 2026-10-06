/**
 * Code execution contracts (TASK §13, PRD §10.11–10.12).
 *
 * Code never runs inside the Next.js process. Flow: route handler -> BullMQ "code-runs" queue -> worker ->
 * CodeRunner (docker-runner.ts: disposable container with --network none, --memory, --cpus, --pids-limit,
 * --read-only, tmpfs workdir, timeout, output cap, no app secrets) -> RunResult persisted on CodeRun.
 *
 * A managed microVM/sandbox can replace Docker by implementing CodeRunner (CODE_RUNNER_DRIVER=remote).
 *
 * Hidden tests: only src/server/runner and src/server/domain/grading may load TestVisibility.HIDDEN cases.
 * `toStudentRunResult()` must be applied before any RunResult leaves the server for a student or student-mode AI.
 */

export type RunnerLanguage = "PYTHON" | "JAVASCRIPT" | "SCALA";

export type TestVisibility = "PUBLIC" | "HIDDEN" | "DIAGNOSTIC";

export type RunStatus =
  | "OK"
  | "COMPILE_ERROR"
  | "RUNTIME_ERROR"
  | "TIMEOUT"
  | "MEMORY_LIMIT"
  | "OUTPUT_LIMIT"
  | "RUNNER_UNAVAILABLE"
  | "INTERNAL_ERROR";

/** Who is at fault — used to separate student code failures from platform failures in alerts/metrics. */
export type RunErrorClass =
  | "STUDENT_COMPILE"
  | "STUDENT_RUNTIME"
  | "STUDENT_TIMEOUT"
  | "STUDENT_MEMORY"
  | "STUDENT_OUTPUT"
  | "PLATFORM_UNAVAILABLE"
  | "PLATFORM_ERROR";

export interface RunFile {
  /** Relative path inside the sandbox workdir, e.g. "main.py". */
  path: string;
  content: string;
}

/**
 * Test specification (also the JSON shape stored in TestCase.input/expected/harness and PracticeItem.tests).
 * Function-call tests call `entryPoint(...args)` and compare the return value; stdio tests feed stdin and compare stdout.
 */
export interface TestSpec {
  id: string;
  name: string;
  visibility: TestVisibility;
  weight: number;
  kind: "function" | "stdio";
  /** function tests */
  entryPoint?: string;
  args?: unknown[];
  expectedReturn?: unknown;
  /** stdio tests */
  stdin?: string;
  expectedStdout?: string;
  /** Comparison: exact JSON equality (default), float tolerance, or whitespace-normalized stdout. */
  comparator?: "exact" | "float" | "normalized_whitespace";
  tolerance?: number;
  timeoutMs?: number;
  /** Optional student-facing hint shown when a PUBLIC test fails. */
  failureHint?: string;
}

export interface RunLimits {
  timeoutMs: number;
  /** Docker memory string, e.g. "256m". */
  memory: string;
  /** Docker cpus string, e.g. "0.5". */
  cpus: string;
  pidsLimit: number;
  outputLimitBytes: number;
}

export interface RunJob {
  /** CodeRun.id — also the BullMQ job id (idempotent enqueue). */
  runId: string;
  language: RunnerLanguage;
  files: RunFile[];
  /** File executed for plain runs. */
  entryFile: string;
  stdin?: string;
  tests: TestSpec[];
  /** "run" executes entryFile; "tests" executes the harness over `tests`. */
  mode: "run" | "tests";
  limits: RunLimits;
}

export interface TestResult {
  testId: string;
  name: string;
  visibility: TestVisibility;
  passed: boolean;
  weight: number;
  /** Student-safe message (PUBLIC only; HIDDEN/DIAGNOSTIC messages are stripped by toStudentRunResult). */
  message?: string;
  /** Actual/expected rendered for PUBLIC tests only. */
  actual?: string;
  expected?: string;
  durationMs?: number;
  status?: RunStatus;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  testResults: TestResult[];
  /** True when stdout/stderr were truncated at limits.outputLimitBytes. */
  truncated: boolean;
  errorClass: RunErrorClass | null;
  /** "docker" | "remote" | ... */
  runnerDriver: string;
}

export interface RunnerHealth {
  driver: string;
  available: boolean;
  /** Per-language image/tooling availability. */
  languages: Partial<Record<RunnerLanguage, boolean>>;
  detail?: string;
}

/** Sandbox provider abstraction. */
export interface CodeRunner {
  readonly driver: string;
  run(job: RunJob): Promise<RunResult>;
  health(): Promise<RunnerHealth>;
}

/** Strip everything a student must not see: hidden/diagnostic results and their messages. */
export function toStudentRunResult(result: RunResult): RunResult {
  return {
    ...result,
    testResults: result.testResults.filter((t) => t.visibility === "PUBLIC").map((t) => ({ ...t })),
  };
}

/** Result used when no runner can execute the job. Never fabricate stdout/test results. */
export function runnerUnavailable(runId: string, driver: string, detail: string): RunResult {
  return {
    runId,
    status: "RUNNER_UNAVAILABLE",
    stdout: "",
    stderr: detail,
    exitCode: null,
    durationMs: 0,
    testResults: [],
    truncated: false,
    errorClass: "PLATFORM_UNAVAILABLE",
    runnerDriver: driver,
  };
}
