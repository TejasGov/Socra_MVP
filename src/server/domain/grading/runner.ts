import "server-only";
import { executeRun } from "@/server/runner/service";
import {
  runnerUnavailable,
  type RunResult,
  type RunnerLanguage,
  type TestSpec,
} from "@/server/runner/types";

/**
 * Runs ALL graded tests (public + hidden) for a submission with kind GRADING through the runner service
 * (queue + worker + sandbox). Never fabricates a result: any failure to reach a runner is RUNNER_UNAVAILABLE.
 */
export async function runGradingTests(args: {
  runId: string;
  language: RunnerLanguage;
  code: string;
  tests: TestSpec[];
}): Promise<RunResult> {
  try {
    return await executeRun({ ...args, kind: "GRADING" });
  } catch (err) {
    return runnerUnavailable(args.runId, "unknown", `Runner error: ${(err as Error).message}`);
  }
}

/** True when the failure is the platform's (retry later), not the student's code. */
export function isPlatformFailure(result: RunResult): boolean {
  return (
    result.status === "RUNNER_UNAVAILABLE" ||
    result.errorClass === "PLATFORM_UNAVAILABLE" ||
    result.errorClass === "PLATFORM_ERROR"
  );
}
