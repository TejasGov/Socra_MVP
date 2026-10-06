import "server-only";
import { prisma, type DbOrTx } from "@/server/db";
import { isKillSwitchOn } from "@/server/ai/gateway";
import { env } from "@/server/env";

/**
 * Operational assistance budget (PRD §10.8): per-session turns, per-user daily turns, per-minute rate,
 * per-course spend, and the global kill switch. Token counts are never shown to students.
 */

/** Exact student-facing copy from PRD §10.8. */
export const SOCRA_LIMIT_MESSAGE =
  "Socra has provided the maximum guided assistance available for this activity. Please take your current work and questions to your TA, office hours, or instructor.";

export const SOCRA_RATE_LIMIT_MESSAGE =
  "You're sending messages faster than Socra can help. Take a moment to try the last suggestion, then ask again.";

export type BudgetLimit = "session_turns" | "daily_turns" | "course_budget" | "kill_switch" | "rate_limit";

export type BudgetDecision = { ok: true } | { ok: false; limit: BudgetLimit; message: string };

export interface BudgetInput {
  userId: string;
  courseId: string;
  sessionTurnCount: number;
  maxTurnsPerSession?: number | null;
  maxTurnsPerDay?: number | null;
  now?: Date;
}

/** Pure decision from counts (unit-testable). */
export function decideBudget(input: {
  killSwitch: boolean;
  courseAiDisabled: boolean;
  courseSpendUsd: number;
  courseBudgetUsd: number;
  courseHardStop: boolean;
  sessionTurnCount: number;
  maxTurnsPerSession: number;
  userTurnsToday: number;
  maxTurnsPerDay: number;
  userTurnsLastMinute: number;
  maxTurnsPerMinute: number;
}): BudgetDecision {
  if (input.killSwitch || input.courseAiDisabled) return { ok: false, limit: "kill_switch", message: SOCRA_LIMIT_MESSAGE };
  if (input.courseHardStop && input.courseBudgetUsd > 0 && input.courseSpendUsd >= input.courseBudgetUsd) {
    return { ok: false, limit: "course_budget", message: SOCRA_LIMIT_MESSAGE };
  }
  if (input.sessionTurnCount >= input.maxTurnsPerSession) return { ok: false, limit: "session_turns", message: SOCRA_LIMIT_MESSAGE };
  if (input.userTurnsToday >= input.maxTurnsPerDay) return { ok: false, limit: "daily_turns", message: SOCRA_LIMIT_MESSAGE };
  if (input.userTurnsLastMinute >= input.maxTurnsPerMinute) return { ok: false, limit: "rate_limit", message: SOCRA_RATE_LIMIT_MESSAGE };
  return { ok: true };
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function checkBudget(input: BudgetInput, db: DbOrTx = prisma): Promise<BudgetDecision> {
  const e = env();
  const now = input.now ?? new Date();
  const budget = await db.courseAiBudget.findUnique({ where: { courseId: input.courseId } });
  const periodStart = budget?.periodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = budget?.periodEnd ?? now;
  const [spend, today, lastMinute, killSwitch] = await Promise.all([
    db.aiRequest.aggregate({
      where: { courseId: input.courseId, createdAt: { gte: periodStart, lte: periodEnd > now ? now : periodEnd } },
      _sum: { costUsd: true },
    }),
    db.aiMessage.count({
      where: { role: "USER", createdAt: { gte: startOfUtcDay(now) }, session: { userId: input.userId } },
    }),
    db.aiMessage.count({
      where: { role: "USER", createdAt: { gte: new Date(now.getTime() - 60_000) }, session: { userId: input.userId } },
    }),
    isKillSwitchOn(),
  ]);
  return decideBudget({
    killSwitch,
    courseAiDisabled: budget?.aiDisabled ?? false,
    courseSpendUsd: Number(spend._sum.costUsd ?? 0),
    courseBudgetUsd: budget ? Number(budget.budgetUsd) : e.AI_COURSE_BUDGET_USD,
    courseHardStop: budget?.hardStop ?? true,
    sessionTurnCount: input.sessionTurnCount,
    maxTurnsPerSession: input.maxTurnsPerSession ?? e.AI_MAX_TURNS_PER_SESSION,
    userTurnsToday: today,
    maxTurnsPerDay: input.maxTurnsPerDay ?? e.AI_MAX_TURNS_PER_USER_DAY,
    userTurnsLastMinute: lastMinute,
    maxTurnsPerMinute: e.AI_RATE_LIMIT_PER_MINUTE,
  });
}
