import "server-only";
import type { RetentionAction, RetentionClass } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { writeAudit } from "@/server/audit";

/**
 * Retention enforcement (PRD §26.4, data-pipelines §1.16). One policy per data category; never "keep forever" by
 * accident: a category with retentionDays = null/0 or action KEEP is reported but untouched.
 *
 * Policy source: RetentionPolicy rows (admin-editable) override env defaults (RETENTION_*_DAYS).
 * Safety: dry-run unless RETENTION_ENFORCE=true and the caller did not ask for a dry run. Dry runs only count.
 *
 * Category -> target:
 *   SENSITIVE_CONVERSATION  AiMessage.content redacted (DEIDENTIFY) or rows deleted (DELETE)
 *   AI_REQUEST_LOG          AiRequest rows (usage/latency metadata; never contains prompt text)
 *   OPERATIONAL             expired/revoked Session rows + PROCESSED OutboxEvent rows
 *   SECURITY_AUDIT          AuditLog rows (append-only; purge flag set inside the transaction)
 *   LEARNING_EVIDENCE       LearningEvidence rows (learner states must be recomputed afterwards)
 *   AGGREGATE               *Aggregate rows not recomputed within the window
 *   IDENTITY / EDUCATIONAL_RECORD / RESEARCH / TRAINING: reported only (institutional process required).
 */

const DAY_MS = 86_400_000;

export interface RetentionCategoryReport {
  category: RetentionClass;
  retentionDays: number | null;
  action: RetentionAction;
  source: "policy" | "env";
  eligible: number;
  applied: number;
  note?: string;
}

export interface RetentionReport {
  dryRun: boolean;
  ranAt: string;
  categories: RetentionCategoryReport[];
}

const ENV_DEFAULTS = (): Record<RetentionClass, { days: number; action: RetentionAction }> => {
  const e = env();
  return {
    IDENTITY: { days: e.RETENTION_IDENTITY_DAYS, action: "KEEP" },
    EDUCATIONAL_RECORD: { days: e.RETENTION_SUBMISSIONS_DAYS, action: "KEEP" },
    SENSITIVE_CONVERSATION: { days: e.RETENTION_RAW_AI_MESSAGES_DAYS, action: "DEIDENTIFY" },
    AI_REQUEST_LOG: { days: e.RETENTION_AI_REQUEST_LOGS_DAYS, action: "DELETE" },
    LEARNING_EVIDENCE: { days: e.RETENTION_LEARNING_EVIDENCE_DAYS, action: "DELETE" },
    AGGREGATE: { days: e.RETENTION_AGGREGATES_DAYS, action: "DELETE" },
    RESEARCH: { days: e.RETENTION_RESEARCH_DAYS, action: "KEEP" },
    SECURITY_AUDIT: { days: e.RETENTION_AUDIT_LOG_DAYS, action: "DELETE" },
    TRAINING: { days: 0, action: "KEEP" },
    OPERATIONAL: { days: e.RETENTION_SESSIONS_DAYS, action: "DELETE" },
  };
};

/** Resolve the effective policy per category. */
export async function getRetentionPolicies() {
  const rows = await prisma.retentionPolicy.findMany();
  const defaults = ENV_DEFAULTS();
  return (Object.keys(defaults) as RetentionClass[]).map((category) => {
    const row = rows.find((r) => r.category === category);
    return row
      ? {
          category,
          retentionDays: row.retentionDays,
          action: row.action,
          source: "policy" as const,
        }
      : {
          category,
          retentionDays: defaults[category].days > 0 ? defaults[category].days : null,
          action: defaults[category].action,
          source: "env" as const,
        };
  });
}

export async function applyRetentionPolicies(
  opts: { dryRun?: boolean; now?: Date; actorId?: string | null } = {},
): Promise<RetentionReport> {
  const dryRun = !(env().RETENTION_ENFORCE && opts.dryRun !== true);
  const now = opts.now ?? new Date();
  const policies = await getRetentionPolicies();
  const categories: RetentionCategoryReport[] = [];

  for (const p of policies) {
    const report: RetentionCategoryReport = { ...p, eligible: 0, applied: 0 };
    categories.push(report);
    if (!p.retentionDays || p.retentionDays <= 0 || p.action === "KEEP" || p.action === "ARCHIVE") {
      report.note =
        p.action === "ARCHIVE" ? "archive target not configured; no action" : "no automatic action";
      continue;
    }
    const cutoff = new Date(now.getTime() - p.retentionDays * DAY_MS);
    switch (p.category) {
      case "SENSITIVE_CONVERSATION": {
        const where = { createdAt: { lt: cutoff }, redactedAt: null };
        report.eligible = await prisma.aiMessage.count({ where });
        if (!dryRun && report.eligible > 0) {
          report.applied =
            p.action === "DELETE"
              ? (await prisma.aiMessage.deleteMany({ where: { createdAt: { lt: cutoff } } })).count
              : (
                  await prisma.aiMessage.updateMany({
                    where,
                    data: { content: "[removed by retention policy]", redactedAt: now },
                  })
                ).count;
          await prisma.aiSession.updateMany({
            where: { lastActivityAt: { lt: cutoff }, summary: { not: null } },
            data: { summary: null },
          });
        }
        break;
      }
      case "AI_REQUEST_LOG": {
        const where = { createdAt: { lt: cutoff } };
        report.eligible = await prisma.aiRequest.count({ where });
        if (!dryRun && report.eligible > 0) {
          report.applied = (await prisma.aiRequest.deleteMany({ where })).count;
        }
        break;
      }
      case "OPERATIONAL": {
        const sessionWhere = { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] };
        const outboxWhere = { status: "PROCESSED" as const, processedAt: { lt: cutoff } };
        report.eligible =
          (await prisma.session.count({ where: sessionWhere })) +
          (await prisma.outboxEvent.count({ where: outboxWhere }));
        if (!dryRun && report.eligible > 0) {
          report.applied =
            (await prisma.session.deleteMany({ where: sessionWhere })).count +
            (await prisma.outboxEvent.deleteMany({ where: outboxWhere })).count;
        }
        break;
      }
      case "SECURITY_AUDIT": {
        const where = { createdAt: { lt: cutoff } };
        report.eligible = await prisma.auditLog.count({ where });
        if (!dryRun && report.eligible > 0) {
          report.applied = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('socra.retention_purge', 'on', true)`;
            return (await tx.auditLog.deleteMany({ where })).count;
          });
        }
        break;
      }
      case "LEARNING_EVIDENCE": {
        const where = { occurredAt: { lt: cutoff } };
        report.eligible = await prisma.learningEvidence.count({ where });
        if (!dryRun && report.eligible > 0) {
          report.applied = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('socra.retention_purge', 'on', true)`;
            return (await tx.learningEvidence.deleteMany({ where })).count;
          });
          report.note = "learner topic states should be recomputed (learner queue { all: true })";
        }
        break;
      }
      case "AGGREGATE": {
        const where = { computedAt: { lt: cutoff } };
        report.eligible =
          (await prisma.courseAggregate.count({ where })) +
          (await prisma.assignmentAggregate.count({ where })) +
          (await prisma.questionAggregate.count({ where })) +
          (await prisma.topicAggregate.count({ where })) +
          (await prisma.misconceptionAggregate.count({ where }));
        if (!dryRun && report.eligible > 0) {
          report.applied =
            (await prisma.courseAggregate.deleteMany({ where })).count +
            (await prisma.assignmentAggregate.deleteMany({ where })).count +
            (await prisma.questionAggregate.deleteMany({ where })).count +
            (await prisma.topicAggregate.deleteMany({ where })).count +
            (await prisma.misconceptionAggregate.deleteMany({ where })).count;
        }
        break;
      }
      default:
        report.note = "requires an institutional deletion process; reported only";
    }
  }

  if (!dryRun) {
    await prisma.retentionPolicy.updateMany({ data: { lastRunAt: now } });
  }
  await writeAudit({
    actorId: opts.actorId ?? null,
    action: "retention.run",
    targetType: "RetentionPolicy",
    metadata: {
      dryRun,
      categories: categories.map((c) => ({
        category: c.category,
        action: c.action,
        retentionDays: c.retentionDays,
        eligible: c.eligible,
        applied: c.applied,
      })),
    },
  });
  return { dryRun, ranAt: now.toISOString(), categories };
}
