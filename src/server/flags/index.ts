import "server-only";
import { prisma, type DbOrTx } from "../db";
import { env, type Env } from "../env";

/**
 * Feature flags (TASK §29, PRD §38).
 *
 * Precedence (highest first):
 *   1. COURSE-scoped FeatureFlag row (scopeKey = courseId)
 *   2. ENVIRONMENT-scoped FeatureFlag row (scopeKey = "env") — runtime admin override
 *   3. FEATURE_* environment variable default
 */

export const FLAG_KEYS = [
  "protectedSocra",
  "practiceGeneration",
  "learnerProfile",
  "facultyAnalytics",
  "individualAnalytics",
  "aiGradingSuggestions",
  "courseRag",
  "postAssessmentSolutions",
  "facultyAiAuthoring",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

export const FLAG_ENV_VARS: Record<FlagKey, keyof Env> = {
  protectedSocra: "FEATURE_PROTECTED_SOCRA",
  practiceGeneration: "FEATURE_PRACTICE_GENERATION",
  learnerProfile: "FEATURE_LEARNER_PROFILE",
  facultyAnalytics: "FEATURE_FACULTY_ANALYTICS",
  individualAnalytics: "FEATURE_INDIVIDUAL_ANALYTICS",
  aiGradingSuggestions: "FEATURE_AI_GRADING_SUGGESTIONS",
  courseRag: "FEATURE_COURSE_RAG",
  postAssessmentSolutions: "FEATURE_POST_ASSESSMENT_SOLUTIONS",
  facultyAiAuthoring: "FEATURE_FACULTY_AI_AUTHORING",
};

export const FLAG_DESCRIPTIONS: Record<FlagKey, string> = {
  protectedSocra: "Socra protected Socratic assistance inside assignments",
  practiceGeneration: "Generated (cached and live) practice questions",
  learnerProfile: "Student topic learning profile",
  facultyAnalytics: "Aggregate faculty analytics dashboards",
  individualAnalytics: "Per-student analytics for instructors",
  aiGradingSuggestions: "AI rubric/feedback suggestions for faculty review",
  courseRag: "Course-material retrieval for Socra",
  postAssessmentSolutions: "Full solutions in post-assessment review mode",
  facultyAiAuthoring: "Faculty AI assignment authoring copilot",
};

export const ENV_SCOPE_KEY = "env";

export function isFlagKey(value: string): value is FlagKey {
  return (FLAG_KEYS as readonly string[]).includes(value);
}

export function envDefault(flag: FlagKey, e: Env = env()): boolean {
  return e[FLAG_ENV_VARS[flag]] === true;
}

export type FlagSource = "course" | "environment_override" | "env_default";

/** Pure precedence resolution (unit-tested). `undefined` means "no row". */
export function resolveFlag(input: {
  envDefault: boolean;
  environmentRow?: boolean;
  courseRow?: boolean;
}): { enabled: boolean; source: FlagSource } {
  if (input.courseRow !== undefined) return { enabled: input.courseRow, source: "course" };
  if (input.environmentRow !== undefined) {
    return { enabled: input.environmentRow, source: "environment_override" };
  }
  return { enabled: input.envDefault, source: "env_default" };
}

export interface FlagState {
  key: FlagKey;
  enabled: boolean;
  source: FlagSource;
  description: string;
}

async function loadRows(db: DbOrTx, flags: readonly FlagKey[], courseId?: string) {
  const scopeKeys = courseId ? [ENV_SCOPE_KEY, courseId] : [ENV_SCOPE_KEY];
  return db.featureFlag.findMany({
    where: { key: { in: [...flags] }, scopeKey: { in: scopeKeys } },
    select: { key: true, scopeKey: true, enabled: true },
  });
}

/** Example: `await isEnabled("protectedSocra", { courseId })`. */
export async function isEnabled(
  flag: FlagKey,
  scope: { courseId?: string } = {},
  db: DbOrTx = prisma,
): Promise<boolean> {
  return (await getFlagState(flag, scope, db)).enabled;
}

export async function getFlagState(
  flag: FlagKey,
  scope: { courseId?: string } = {},
  db: DbOrTx = prisma,
): Promise<FlagState> {
  const rows = await loadRows(db, [flag], scope.courseId);
  const environmentRow = rows.find((r) => r.scopeKey === ENV_SCOPE_KEY)?.enabled;
  const courseRow = scope.courseId
    ? rows.find((r) => r.scopeKey === scope.courseId)?.enabled
    : undefined;
  const resolved = resolveFlag({ envDefault: envDefault(flag), environmentRow, courseRow });
  return { key: flag, ...resolved, description: FLAG_DESCRIPTIONS[flag] };
}

/** All flags for a scope (admin pages, client bootstrapping). */
export async function getAllFlags(
  scope: { courseId?: string } = {},
  db: DbOrTx = prisma,
): Promise<FlagState[]> {
  const rows = await loadRows(db, FLAG_KEYS, scope.courseId);
  return FLAG_KEYS.map((key) => {
    const environmentRow = rows.find((r) => r.key === key && r.scopeKey === ENV_SCOPE_KEY)?.enabled;
    const courseRow = scope.courseId
      ? rows.find((r) => r.key === key && r.scopeKey === scope.courseId)?.enabled
      : undefined;
    return {
      key,
      ...resolveFlag({ envDefault: envDefault(key), environmentRow, courseRow }),
      description: FLAG_DESCRIPTIONS[key],
    };
  });
}

/**
 * Upsert an override. `courseId` undefined => ENVIRONMENT scope. `enabled: null` removes the override.
 * Callers must authorize ("admin:flags:manage") and write an audit entry ("flag.update") in the same tx.
 */
export async function setFlagOverride(
  flag: FlagKey,
  enabled: boolean | null,
  opts: { courseId?: string; updatedById?: string } = {},
  db: DbOrTx = prisma,
): Promise<void> {
  const scopeKey = opts.courseId ?? ENV_SCOPE_KEY;
  if (enabled === null) {
    await db.featureFlag.deleteMany({ where: { key: flag, scopeKey } });
    return;
  }
  await db.featureFlag.upsert({
    where: { key_scopeKey: { key: flag, scopeKey } },
    create: {
      key: flag,
      scope: opts.courseId ? "COURSE" : "ENVIRONMENT",
      scopeKey,
      courseId: opts.courseId ?? null,
      enabled,
      description: FLAG_DESCRIPTIONS[flag],
      updatedById: opts.updatedById ?? null,
    },
    update: { enabled, updatedById: opts.updatedById ?? null },
  });
}
