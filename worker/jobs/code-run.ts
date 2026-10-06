import type { Job } from "bullmq";
import { getCodeRunner } from "@/server/runner";
import type { RunJob, RunResult } from "@/server/runner/types";

/**
 * BullMQ processor for the "code-runs" queue. Concurrency is set from RUNNER_CONCURRENCY (default 4) in worker/index.ts.
 * The job payload is a full RunJob built by executeRun(); the return value is the RunResult (never throws for student
 * code failures; platform failures come back as RUNNER_UNAVAILABLE / INTERNAL_ERROR results).
 */
export async function processCodeRunJob(job: Job<RunJob>): Promise<RunResult> {
  return getCodeRunner().run(job.data);
}
