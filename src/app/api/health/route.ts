import { NextResponse } from "next/server";
import { getAppHealth } from "@/server/health";

export const dynamic = "force-dynamic";

/** Liveness/readiness: db, redis, runner driver, AI mode. No secrets or config values beyond modes. */
export async function GET() {
  const report = await getAppHealth();
  // Unauthenticated endpoint: no driver error text (it can name hosts/ports); admins see details at /admin/health.
  const { error: _dbError, ...database } = report.checks.database;
  return NextResponse.json(
    { ...report, checks: { ...report.checks, database }, warnings: report.warnings.length },
    { status: report.status === "down" ? 503 : 200 },
  );
}
