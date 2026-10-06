import "server-only";
import { env } from "../env";
import {
  runnerUnavailable,
  type CodeRunner,
  type RunJob,
  type RunResult,
  type RunnerHealth,
} from "./types";

/**
 * RemoteRunner — CODE_RUNNER_DRIVER=remote. Delegates execution to a managed sandbox / microVM service.
 *
 * HTTP contract the remote service must implement (JSON, UTF-8, optional `Authorization: Bearer REMOTE_RUNNER_TOKEN`):
 *
 *   POST {REMOTE_RUNNER_URL}/v1/run      body: RunJob (see ./types.ts)   -> 200 RunResult
 *     - The service must enforce job.limits (timeout, memory, cpus, pids, output bytes), run with no network and no
 *       secrets, and compare tests itself (TestSpec.expectedReturn / expectedStdout are included in RunJob.tests).
 *     - Test failures are NOT HTTP errors: return 200 with testResults[].passed=false.
 *     - HTTP 5xx / network failure is mapped here to RUNNER_UNAVAILABLE (never fabricated output).
 *   GET  {REMOTE_RUNNER_URL}/v1/health  -> 200 RunnerHealth
 *
 * Because RunJob contains hidden test expectations, REMOTE_RUNNER_URL must be a trusted, TLS-protected endpoint.
 * This class is a thin client; it has not been exercised against a live provider in this repository.
 */
export class RemoteRunner implements CodeRunner {
  readonly driver = "remote";

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    const t = env().REMOTE_RUNNER_TOKEN;
    if (t) h.authorization = `Bearer ${t}`;
    return h;
  }

  async run(job: RunJob): Promise<RunResult> {
    const base = env().REMOTE_RUNNER_URL;
    if (!base) return runnerUnavailable(job.runId, this.driver, "REMOTE_RUNNER_URL is not configured");
    try {
      const res = await fetch(new URL("/v1/run", base), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(job.limits.timeoutMs * 2 + 10_000),
      });
      if (!res.ok) return runnerUnavailable(job.runId, this.driver, `Remote runner returned HTTP ${res.status}`);
      const body = (await res.json()) as RunResult;
      return { ...body, runId: job.runId, runnerDriver: this.driver };
    } catch (err) {
      return runnerUnavailable(
        job.runId,
        this.driver,
        `Remote runner unreachable: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  async health(): Promise<RunnerHealth> {
    const base = env().REMOTE_RUNNER_URL;
    if (!base) return { driver: this.driver, available: false, languages: {}, detail: "REMOTE_RUNNER_URL is not configured" };
    try {
      const res = await fetch(new URL("/v1/health", base), {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { driver: this.driver, available: false, languages: {}, detail: `HTTP ${res.status}` };
      return { ...((await res.json()) as RunnerHealth), driver: this.driver };
    } catch (err) {
      return {
        driver: this.driver,
        available: false,
        languages: {},
        detail: err instanceof Error ? err.message : "unreachable",
      };
    }
  }
}
