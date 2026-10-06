import "server-only";
import { env } from "@/server/env";
import { getAppHealth } from "@/server/health";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { isAiKillSwitchOn } from "./ai";

export interface WorkerHealth {
  reachable: boolean;
  url: string;
  status?: string;
  error?: string;
  detail?: unknown;
}

/** Fetch the worker's /health on the local WORKER_HEALTH_PORT (override the host with WORKER_HEALTH_HOST). */
export async function fetchWorkerHealth(): Promise<WorkerHealth> {
  const host = process.env.WORKER_HEALTH_HOST || "127.0.0.1";
  const url = `http://${host}:${env().WORKER_HEALTH_PORT}/health`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return { reachable: true, url, status: body?.status ?? `http_${res.status}`, detail: body };
  } catch (err) {
    return {
      reachable: false,
      url,
      error: err instanceof Error ? err.message.split("\n")[0] : "unreachable",
    };
  }
}

/** Runner health is configuration-level here: the runner never fabricates results, and the worker owns execution. */
export async function getSystemHealth(user: Principal) {
  assertCan(user, "admin:health:read");
  const [app, worker, killSwitch] = await Promise.all([
    getAppHealth(),
    fetchWorkerHealth(),
    isAiKillSwitchOn().catch(() => false),
  ]);
  const e = env();
  const runner = {
    driver: e.CODE_RUNNER_DRIVER,
    remoteConfigured: e.CODE_RUNNER_DRIVER === "remote" ? Boolean(e.REMOTE_RUNNER_URL) : null,
    // Runs execute inside the worker; if the worker is down, runs report RUNNER_UNAVAILABLE.
    executing: worker.reachable && worker.status !== "down",
  };
  return {
    app,
    worker,
    runner,
    ai: { mockMode: e.AI_MOCK_MODE, reason: e.AI_MODE_REASON, killSwitch },
  };
}
