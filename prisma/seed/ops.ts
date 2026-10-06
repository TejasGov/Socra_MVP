import { Prisma } from "@/generated/prisma/client";
import type { RetentionAction, RetentionClass } from "@/generated/prisma/enums";
import { env } from "@/server/env";
import type { SeedContext } from "./context";

/**
 * Operational defaults: model routing/pricing, per-course AI budgets, retention policy rows.
 * Feature flags are NOT seeded as DB rows: FEATURE_* env vars are the defaults and DB rows are explicit
 * overrides only (see docs/ASSUMPTIONS.md).
 */

export async function seedModelConfig(ctx: SeedContext): Promise<void> {
  const e = env();
  const rows: Array<{
    key: string;
    model: string;
    input: number;
    cached: number;
    output: number;
    maxOutputTokens?: number;
    notes: string;
  }> = [
    {
      key: "tier:protected",
      model: e.OPENAI_PROTECTED_MODEL,
      input: e.AI_PRICE_PROTECTED_INPUT_PER_1M,
      cached: e.AI_PRICE_PROTECTED_CACHED_INPUT_PER_1M,
      output: e.AI_PRICE_PROTECTED_OUTPUT_PER_1M,
      maxOutputTokens: e.OPENAI_MAX_OUTPUT_TOKENS,
      notes:
        "Protected Socratic tutor, post-assessment review, faculty authoring, grading suggestions. Fixed per study cohort.",
    },
    {
      key: "tier:economy",
      model: e.OPENAI_ECONOMY_MODEL,
      input: e.AI_PRICE_ECONOMY_INPUT_PER_1M,
      cached: e.AI_PRICE_ECONOMY_CACHED_INPUT_PER_1M,
      output: e.AI_PRICE_ECONOMY_OUTPUT_PER_1M,
      maxOutputTokens: e.OPENAI_MAX_OUTPUT_TOKENS,
      notes:
        "Practice generation/tutoring, misconception extraction, topic classification, analytics brief.",
    },
    {
      key: "tier:embedding",
      model: e.OPENAI_EMBEDDING_MODEL,
      input: e.AI_PRICE_EMBEDDING_PER_1M,
      cached: 0,
      output: 0,
      notes: "Course resource and practice item embeddings (vector(1536)).",
    },
  ];
  for (const r of rows) {
    const data = {
      provider: "OPENAI" as const,
      model: r.model,
      maxOutputTokens: r.maxOutputTokens ?? null,
      inputPricePer1M: new Prisma.Decimal(r.input),
      cachedInputPricePer1M: new Prisma.Decimal(r.cached),
      outputPricePer1M: new Prisma.Decimal(r.output),
      isActive: true,
      notes: r.notes,
    };
    await ctx.prisma.modelConfiguration.upsert({
      where: { key_scopeKey: { key: r.key, scopeKey: "global" } },
      create: { key: r.key, scopeKey: "global", ...data },
      update: data,
    });
  }
  ctx.log(`model configurations: ${rows.length}`);
}

export async function seedBudgets(ctx: SeedContext): Promise<void> {
  const periodStart = new Date(Date.UTC(2026, 7, 24)); // 2026-08-24, Fall 2026 start
  const periodEnd = new Date(Date.UTC(2026, 11, 20)); // 2026-12-20
  for (const courseId of Object.values(ctx.ids.courses)) {
    await ctx.prisma.courseAiBudget.upsert({
      where: { courseId },
      create: {
        courseId,
        budgetUsd: new Prisma.Decimal(env().AI_COURSE_BUDGET_USD),
        periodStart,
        periodEnd,
        alertThresholdPct: env().AI_BUDGET_ALERT_PCT,
        hardStop: true,
      },
      update: {},
    });
  }
  ctx.log(`course AI budgets: ${Object.keys(ctx.ids.courses).length}`);
}

export async function seedRetention(ctx: SeedContext): Promise<void> {
  const e = env();
  const policies: Array<{
    category: RetentionClass;
    days: number;
    action: RetentionAction;
    description: string;
  }> = [
    {
      category: "IDENTITY",
      days: e.RETENTION_IDENTITY_DAYS,
      action: "DEIDENTIFY",
      description: "Account identity (name, email, institutional subject).",
    },
    {
      category: "EDUCATIONAL_RECORD",
      days: e.RETENTION_SUBMISSIONS_DAYS,
      action: "KEEP",
      description: "Submissions and grades; follows university course-records policy.",
    },
    {
      category: "SENSITIVE_CONVERSATION",
      days: e.RETENTION_RAW_AI_MESSAGES_DAYS,
      action: "DELETE",
      description: "Raw Socra messages and conversation summaries.",
    },
    {
      category: "AI_REQUEST_LOG",
      days: e.RETENTION_AI_REQUEST_LOGS_DAYS,
      action: "DELETE",
      description: "AI request usage/latency metadata (no content).",
    },
    {
      category: "LEARNING_EVIDENCE",
      days: e.RETENTION_LEARNING_EVIDENCE_DAYS,
      action: "DEIDENTIFY",
      description: "Derived learning evidence; learner state is recomputed.",
    },
    {
      category: "AGGREGATE",
      days: e.RETENTION_AGGREGATES_DAYS,
      action: "KEEP",
      description: "Aggregate analytics tables.",
    },
    {
      category: "RESEARCH",
      days: e.RETENTION_RESEARCH_DAYS,
      action: "KEEP",
      description: "Research datasets per IRB data-management plan.",
    },
    {
      category: "SECURITY_AUDIT",
      days: e.RETENTION_AUDIT_LOG_DAYS,
      action: "DELETE",
      description: "Append-only audit log.",
    },
    {
      category: "OPERATIONAL",
      days: e.RETENTION_SESSIONS_DAYS,
      action: "DELETE",
      description: "Expired sessions and operational records.",
    },
    {
      category: "TRAINING",
      days: 0,
      action: "KEEP",
      description: "Curated training/eval datasets (separate lifecycle).",
    },
  ];
  for (const p of policies) {
    await ctx.prisma.retentionPolicy.upsert({
      where: { category: p.category },
      create: {
        category: p.category,
        retentionDays: p.days > 0 ? p.days : null,
        action: p.action,
        description: p.description,
      },
      update: { description: p.description },
    });
  }
  ctx.log(`retention policies: ${policies.length}`);
}
