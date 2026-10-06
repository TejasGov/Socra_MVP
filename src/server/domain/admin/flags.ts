import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";
import {
  ENV_SCOPE_KEY,
  FLAG_DESCRIPTIONS,
  FLAG_KEYS,
  envDefault,
  isFlagKey,
  resolveFlag,
  setFlagOverride,
  type FlagKey,
  type FlagSource,
} from "@/server/flags";

export interface FlagMatrixRow {
  key: FlagKey;
  description: string;
  envDefault: boolean;
  environmentOverride: boolean | null;
  /** Effective value without any course scope. */
  effective: boolean;
  effectiveSource: FlagSource;
  courses: Array<{
    courseId: string;
    override: boolean | null;
    effective: boolean;
    source: FlagSource;
  }>;
}

/** All flags with env default, environment override, per-course override and effective value. */
export async function getFlagMatrix(
  user: Principal,
): Promise<{ courses: Array<{ id: string; code: string }>; flags: FlagMatrixRow[] }> {
  assertCan(user, "admin:flags:manage");
  const [courses, rows] = await Promise.all([
    prisma.course.findMany({
      where: { isActive: true },
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    }),
    prisma.featureFlag.findMany({
      where: { key: { in: [...FLAG_KEYS] } },
      select: { key: true, scopeKey: true, enabled: true },
    }),
  ]);
  const flags = FLAG_KEYS.map((key): FlagMatrixRow => {
    const def = envDefault(key);
    const envRow = rows.find((r) => r.key === key && r.scopeKey === ENV_SCOPE_KEY)?.enabled;
    const base = resolveFlag({ envDefault: def, environmentRow: envRow });
    return {
      key,
      description: FLAG_DESCRIPTIONS[key],
      envDefault: def,
      environmentOverride: envRow ?? null,
      effective: base.enabled,
      effectiveSource: base.source,
      courses: courses.map((c) => {
        const courseRow = rows.find((r) => r.key === key && r.scopeKey === c.id)?.enabled;
        const resolved = resolveFlag({ envDefault: def, environmentRow: envRow, courseRow });
        return {
          courseId: c.id,
          override: courseRow ?? null,
          effective: resolved.enabled,
          source: resolved.source,
        };
      }),
    };
  });
  return { courses, flags };
}

export const flagUpdateSchema = z.object({
  key: z.string().refine(isFlagKey, "Unknown flag"),
  /** Omit for the environment-wide override. */
  courseId: z.string().min(1).optional(),
  /** null removes the override (falls back to the next scope). */
  enabled: z.boolean().nullable(),
});

export async function updateFlag(user: Principal, input: z.infer<typeof flagUpdateSchema>) {
  assertCan(user, "admin:flags:manage");
  const key = input.key as FlagKey;
  return prisma.$transaction(async (tx) => {
    if (input.courseId) {
      const course = await tx.course.findUnique({
        where: { id: input.courseId },
        select: { id: true },
      });
      if (!course) throw new HttpError(404, "course_not_found", "Course not found");
    }
    const scopeKey = input.courseId ?? ENV_SCOPE_KEY;
    const before = await tx.featureFlag.findUnique({
      where: { key_scopeKey: { key, scopeKey } },
      select: { enabled: true },
    });
    await setFlagOverride(
      key,
      input.enabled,
      { courseId: input.courseId, updatedById: user.id },
      tx,
    );
    await writeAudit(
      {
        actorId: user.id,
        action: "flag.update",
        targetType: "FeatureFlag",
        targetId: `${key}:${scopeKey}`,
        courseId: input.courseId ?? null,
        metadata: {
          key,
          scope: input.courseId ? "COURSE" : "ENVIRONMENT",
          before: before?.enabled ?? null,
          after: input.enabled,
        },
      },
      tx,
    );
    return { key, scopeKey, enabled: input.enabled };
  });
}
