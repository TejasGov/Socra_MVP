import "server-only";
import { prisma } from "@/server/db";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { isAiKillSwitchOn } from "./ai";

/** Real counts for the admin landing page (no estimates). */
export async function getAdminOverview(user: Principal) {
  assertCan(user, "admin:health:read");
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [
    courses,
    openJobFailures,
    failedOutbox,
    quarantined,
    ai24h,
    aiFailed24h,
    killSwitch,
    recentAudit,
  ] = await Promise.all([
    prisma.course.count({ where: { isActive: true } }),
    prisma.backgroundJobFailure.count({ where: { resolvedAt: null } }),
    prisma.outboxEvent.count({ where: { status: "FAILED" } }),
    prisma.outboxEvent.count({ where: { status: "QUARANTINED" } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: since } } }),
    prisma.aiRequest.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
    isAiKillSwitchOn().catch(() => false),
    prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  return {
    courses,
    openJobFailures,
    failedOutbox,
    quarantined,
    ai24h,
    aiFailed24h,
    killSwitch,
    recentAudit,
  };
}
