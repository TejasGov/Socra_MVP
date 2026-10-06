import "server-only";
import { getQueue, getQueueEvents, QUEUE_NAMES } from "../queues";
import { env } from "../env";
import { pingRedis } from "../redis";
import { defaultRunLimits } from "./index";
import {
  runnerUnavailable,
  type RunFile,
  type RunJob,
  type RunResult,
  type RunnerLanguage,
  type TestSpec,
} from "./types";

/**
 * Run orchestration (contract: B — executeRun). Route/worker callers never touch Docker directly:
 *   executeRun -> BullMQ "code-runs" -> worker (worker/jobs/code-run.ts) -> getCodeRunner().run(job)
 * If Redis or the worker is not reachable within ~3s, or the wait times out, the result is RUNNER_UNAVAILABLE.
 * Output is never fabricated. Job payloads hold the code and (for GRADING / PUBLIC_TESTS) test specs; they live only in
 * server-side Redis and are removed about 60 seconds after completion (CODE_RUN_JOB_RETENTION_S).
 */

export interface ExecuteRunInput {
  runId: string;
  language: RunnerLanguage;
  code: string;
  stdin?: string;
  tests: TestSpec[];
  kind: "RUN" | "PUBLIC_TESTS" | "GRADING";
}

export const ENTRY_FILE: Record<RunnerLanguage, string> = {
  PYTHON: "main.py",
  JAVASCRIPT: "main.js",
  SCALA: "main.scala",
};

export function buildRunJob(input: ExecuteRunInput): RunJob {
  const files: RunFile[] = [{ path: ENTRY_FILE[input.language], content: input.code }];
  const mode = input.kind === "RUN" ? "run" : "tests";
  return {
    runId: input.runId,
    language: input.language,
    files,
    entryFile: ENTRY_FILE[input.language],
    stdin: input.stdin,
    tests: mode === "tests" ? input.tests : [],
    mode,
    limits: defaultRunLimits(input.language),
  };
}

const AVAILABILITY_PROBE_MS = 3000;
/** Seconds a finished code-run job (payload + result) stays in Redis. */
export const CODE_RUN_JOB_RETENTION_S = 60;

async function workerReachable(): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!(await pingRedis(AVAILABILITY_PROBE_MS))) {
    return { ok: false, detail: "Code runner is unavailable (queue backend unreachable)." };
  }
  try {
    const workers = await Promise.race([
      getQueue(QUEUE_NAMES.codeRuns).getWorkers(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), AVAILABILITY_PROBE_MS)),
    ]);
    if (workers.length === 0) {
      return { ok: false, detail: "Code runner is unavailable (no worker is processing runs)." };
    }
    return { ok: true };
  } catch {
    return { ok: false, detail: "Code runner is unavailable (worker did not respond)." };
  }
}

export async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
  const driver = env().CODE_RUNNER_DRIVER;
  const probe = await workerReachable();
  if (!probe.ok) return runnerUnavailable(input.runId, driver, probe.detail);

  const job = buildRunJob(input);
  const queue = getQueue(QUEUE_NAMES.codeRuns);
  const events = getQueueEvents(QUEUE_NAMES.codeRuns);
  try {
    await Promise.race([
      events.waitUntilReady(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), AVAILABILITY_PROBE_MS)),
    ]);
    // The payload carries the student's code and, for GRADING, hidden-test expectations: keep it in Redis only
    // as long as the waiter needs it. A short (not zero) age avoids racing waitUntilFinished's state check.
    const queued = await queue.add("run", job, {
      jobId: input.runId,
      attempts: 1,
      removeOnComplete: { age: CODE_RUN_JOB_RETENTION_S },
      removeOnFail: { age: CODE_RUN_JOB_RETENTION_S },
    });
    const waitMs = Math.min(env().RUNNER_WAIT_TIMEOUT_MS, job.limits.timeoutMs * 3 + 30_000);
    try {
      const result = (await queued.waitUntilFinished(events, waitMs)) as RunResult;
      // The result is in hand: drop the payload now rather than waiting for the age-based cleanup.
      await queued.remove().catch(() => undefined);
      return result;
    } catch (err) {
      await queued.remove().catch(() => undefined);
      const msg = err instanceof Error ? err.message : "";
      return runnerUnavailable(
        input.runId,
        driver,
        /timed out/i.test(msg)
          ? "The code runner did not respond in time. Your work is saved; try again shortly."
          : "The code runner failed to execute this run.",
      );
    }
  } catch {
    return runnerUnavailable(input.runId, driver, "Code runner is unavailable (could not enqueue the run).");
  }
}
