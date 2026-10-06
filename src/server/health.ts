import "server-only";
import { prisma } from "./db";
import { env } from "./env";
import { pingRedis } from "./redis";

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  appVersion: string;
  time: string;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean };
    runner: { driver: string };
    ai: { mockMode: boolean; reason: string; killSwitch: boolean };
    auth: { localEnabled: boolean; oidcConfigured: boolean };
  };
  warnings: string[];
}

export async function checkDatabase(): Promise<HealthReport["checks"]["database"]> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split("\n")[0] : "unknown" };
  }
}

/** App health: database is required ("down" without it); Redis is degraded-only (runs/queues unavailable). */
export async function getAppHealth(): Promise<HealthReport> {
  const e = env();
  const [database, redisOk] = await Promise.all([checkDatabase(), pingRedis()]);
  const status: HealthReport["status"] = !database.ok ? "down" : redisOk ? "ok" : "degraded";
  return {
    status,
    appVersion: e.APP_VERSION,
    time: new Date().toISOString(),
    checks: {
      database,
      redis: { ok: redisOk },
      runner: { driver: e.CODE_RUNNER_DRIVER },
      ai: { mockMode: e.AI_MOCK_MODE, reason: e.AI_MODE_REASON, killSwitch: e.AI_KILL_SWITCH },
      auth: { localEnabled: e.AUTH_LOCAL_ENABLED, oidcConfigured: e.OIDC_CONFIGURED },
    },
    warnings: e.warnings,
  };
}
