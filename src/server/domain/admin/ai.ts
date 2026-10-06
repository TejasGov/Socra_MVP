import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { ENV_SCOPE_KEY } from "@/server/flags";

/** Runtime kill-switch row (FeatureFlag, ENVIRONMENT scope). Env `AI_KILL_SWITCH=true` always wins. */
export const AI_KILL_SWITCH_KEY = "ai_kill_switch";

/** True when AI must refuse student calls (env or admin runtime switch). The AI gateway may call this. */
export async function isAiKillSwitchOn(): Promise<boolean> {
  if (env().AI_KILL_SWITCH) return true;
  const row = await prisma.featureFlag.findUnique({
    where: { key_scopeKey: { key: AI_KILL_SWITCH_KEY, scopeKey: ENV_SCOPE_KEY } },
    select: { enabled: true },
  });
  return row?.enabled === true;
}

export async function getAiAdminState(user: Principal) {
  assertCan(user, "admin:ai_config:manage");
  const e = env();
  const [configs, budgets, courses, killRow, spend] = await Promise.all([
    prisma.modelConfiguration.findMany({ orderBy: [{ key: "asc" }, { scopeKey: "asc" }] }),
    prisma.courseAiBudget.findMany(),
    prisma.course.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    }),
    prisma.featureFlag.findUnique({
      where: { key_scopeKey: { key: AI_KILL_SWITCH_KEY, scopeKey: ENV_SCOPE_KEY } },
      select: { enabled: true, updatedAt: true },
    }),
    prisma.aiRequest.groupBy({
      by: ["courseId"],
      where: { courseId: { not: null }, status: { in: ["SUCCEEDED", "FALLBACK"] } },
      _sum: { costUsd: true },
    }),
  ]);
  const spendByCourse = new Map(spend.map((s) => [s.courseId, Number(s._sum.costUsd ?? 0)]));
  const budgetByCourse = new Map(budgets.map((b) => [b.courseId, b]));
  return {
    mockMode: { enabled: e.AI_MOCK_MODE, reason: e.AI_MODE_REASON },
    // The key itself is never read into the page; only whether one is configured.
    apiKey: e.OPENAI_API_KEY ? ("configured" as const) : ("not configured" as const),
    killSwitch: {
      env: e.AI_KILL_SWITCH,
      runtime: killRow?.enabled === true,
      active: e.AI_KILL_SWITCH || killRow?.enabled === true,
      updatedAt: killRow?.updatedAt ?? null,
    },
    envModels: [
      { tier: "protected", model: e.OPENAI_PROTECTED_MODEL },
      { tier: "economy", model: e.OPENAI_ECONOMY_MODEL },
      { tier: "embedding", model: e.OPENAI_EMBEDDING_MODEL },
    ],
    defaults: {
      courseBudgetUsd: e.AI_COURSE_BUDGET_USD,
      alertPct: e.AI_BUDGET_ALERT_PCT,
      maxTurnsPerSession: e.AI_MAX_TURNS_PER_SESSION,
      maxTurnsPerUserDay: e.AI_MAX_TURNS_PER_USER_DAY,
    },
    configs: configs.map((c) => ({
      id: c.id,
      key: c.key,
      scopeKey: c.scopeKey,
      provider: c.provider,
      model: c.model,
      temperature: c.temperature,
      maxOutputTokens: c.maxOutputTokens,
      reasoningEffort: c.reasoningEffort,
      inputPricePer1M: Number(c.inputPricePer1M),
      cachedInputPricePer1M: Number(c.cachedInputPricePer1M),
      outputPricePer1M: Number(c.outputPricePer1M),
      isActive: c.isActive,
      notes: c.notes,
    })),
    courses: courses.map((c) => {
      const b = budgetByCourse.get(c.id);
      return {
        courseId: c.id,
        code: c.code,
        spentUsd: spendByCourse.get(c.id) ?? 0,
        budget: b
          ? {
              budgetUsd: Number(b.budgetUsd),
              periodStart: b.periodStart,
              periodEnd: b.periodEnd,
              alertThresholdPct: b.alertThresholdPct,
              hardStop: b.hardStop,
              aiDisabled: b.aiDisabled,
            }
          : null,
      };
    }),
  };
}

const price = z.coerce.number().min(0).max(100000);

export const modelConfigSchema = z.object({
  key: z.string().trim().min(2).max(80),
  model: z.string().trim().min(2).max(120),
  provider: z.enum(["OPENAI", "MOCK"]).default("OPENAI"),
  temperature: z.coerce.number().min(0).max(2).nullable().optional(),
  maxOutputTokens: z.coerce.number().int().min(16).max(64000).nullable().optional(),
  reasoningEffort: z.string().trim().max(20).nullable().optional(),
  inputPricePer1M: price,
  cachedInputPricePer1M: price,
  outputPricePer1M: price,
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function upsertModelConfiguration(
  user: Principal,
  input: z.infer<typeof modelConfigSchema>,
) {
  assertCan(user, "admin:ai_config:manage");
  return prisma.$transaction(async (tx) => {
    const before = await tx.modelConfiguration.findUnique({
      where: { key_scopeKey: { key: input.key, scopeKey: "global" } },
    });
    const data = {
      provider: input.provider,
      model: input.model,
      temperature: input.temperature ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      inputPricePer1M: input.inputPricePer1M,
      cachedInputPricePer1M: input.cachedInputPricePer1M,
      outputPricePer1M: input.outputPricePer1M,
      isActive: input.isActive,
      notes: input.notes ?? null,
      updatedById: user.id,
    };
    const row = await tx.modelConfiguration.upsert({
      where: { key_scopeKey: { key: input.key, scopeKey: "global" } },
      create: { key: input.key, scopeKey: "global", ...data },
      update: data,
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "ai_config.update",
        targetType: "ModelConfiguration",
        targetId: row.id,
        metadata: {
          key: input.key,
          modelBefore: before?.model ?? null,
          modelAfter: input.model,
          isActive: input.isActive,
        },
      },
      tx,
    );
    return row;
  });
}

export const budgetSchema = z
  .object({
    courseId: z.string().min(1),
    budgetUsd: z.coerce.number().min(0).max(1_000_000),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    alertThresholdPct: z.coerce.number().int().min(1).max(100).default(80),
    hardStop: z.boolean().default(true),
    aiDisabled: z.boolean().default(false),
  })
  .refine((v) => v.periodEnd > v.periodStart, {
    message: "Period end must be after period start",
    path: ["periodEnd"],
  });

export async function setCourseBudget(user: Principal, input: z.infer<typeof budgetSchema>) {
  assertCan(user, "admin:ai_config:manage");
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: input.courseId },
      select: { id: true },
    });
    if (!course) throw new HttpError(404, "course_not_found", "Course not found");
    const before = await tx.courseAiBudget.findUnique({ where: { courseId: input.courseId } });
    const data = {
      budgetUsd: input.budgetUsd,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      alertThresholdPct: input.alertThresholdPct,
      hardStop: input.hardStop,
      aiDisabled: input.aiDisabled,
      updatedById: user.id,
    };
    const row = await tx.courseAiBudget.upsert({
      where: { courseId: input.courseId },
      create: { courseId: input.courseId, ...data },
      update: data,
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "ai_budget.update",
        targetType: "CourseAiBudget",
        targetId: row.id,
        courseId: input.courseId,
        metadata: {
          budgetBefore: before ? Number(before.budgetUsd) : null,
          budgetAfter: input.budgetUsd,
          aiDisabledBefore: before?.aiDisabled ?? null,
          aiDisabledAfter: input.aiDisabled,
          hardStop: input.hardStop,
        },
      },
      tx,
    );
    return row;
  });
}

export const killSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(5, "Give a short reason").max(500),
});

/** Global AI kill switch: AI is refused, assignment editing/running/submitting keeps working. */
export async function setAiKillSwitch(user: Principal, input: z.infer<typeof killSwitchSchema>) {
  assertCan(user, "admin:ai_config:manage");
  return prisma.$transaction(async (tx) => {
    const before = await tx.featureFlag.findUnique({
      where: { key_scopeKey: { key: AI_KILL_SWITCH_KEY, scopeKey: ENV_SCOPE_KEY } },
    });
    await tx.featureFlag.upsert({
      where: { key_scopeKey: { key: AI_KILL_SWITCH_KEY, scopeKey: ENV_SCOPE_KEY } },
      create: {
        key: AI_KILL_SWITCH_KEY,
        scope: "ENVIRONMENT",
        scopeKey: ENV_SCOPE_KEY,
        enabled: input.enabled,
        description: "Global AI kill switch (admin runtime override)",
        updatedById: user.id,
      },
      update: { enabled: input.enabled, updatedById: user.id },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "ai_config.update",
        targetType: "AiKillSwitch",
        targetId: AI_KILL_SWITCH_KEY,
        reason: input.reason,
        metadata: { before: before?.enabled ?? false, after: input.enabled },
      },
      tx,
    );
    return { enabled: input.enabled };
  });
}
