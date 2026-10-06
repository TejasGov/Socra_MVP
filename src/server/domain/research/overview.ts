import "server-only";
import { prisma } from "@/server/db";
import { assertCan, type Principal } from "@/server/auth/rbac";

/** Study-level counts for the research landing page. No identities. */
export async function getResearchOverview(user: Principal) {
  assertCan(user, "research:read");
  const [byCondition, byConsent, exportsByStatus, events, lastExport] = await Promise.all([
    prisma.studyParticipant.groupBy({ by: ["condition"], _count: { _all: true } }),
    prisma.studyParticipant.groupBy({ by: ["consentStatus"], _count: { _all: true } }),
    prisma.researchExport.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.analyticsEvent.count({
      where: { status: "ACCEPTED", researchCondition: { not: null } },
    }),
    prisma.researchExport.findFirst({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, rowCount: true },
    }),
  ]);
  return {
    byCondition: byCondition.map((c) => ({ condition: c.condition, count: c._count._all })),
    byConsent: byConsent.map((c) => ({ consent: c.consentStatus, count: c._count._all })),
    exportsByStatus: exportsByStatus.map((e) => ({ status: e.status, count: e._count._all })),
    conditionStampedEvents: events,
    lastExport,
  };
}
