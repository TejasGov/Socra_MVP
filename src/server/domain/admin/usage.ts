import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { assertCan, type Principal } from "@/server/auth/rbac";

export const usageQuerySchema = z.object({
  courseId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Max rows returned (grouped by day, course, mode, model). */
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export interface UsageRow {
  day: string;
  courseId: string | null;
  courseCode: string | null;
  mode: string;
  model: string;
  requests: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  failures: number;
  failureRate: number | null;
  p95LatencyMs: number | null;
}

interface RawUsage {
  day: Date;
  courseId: string | null;
  mode: string;
  model: string;
  requests: bigint;
  inputTokens: bigint | null;
  cachedTokens: bigint | null;
  outputTokens: bigint | null;
  costUsd: Prisma.Decimal | null;
  failures: bigint;
  p95: number | null;
}

/** Aggregates real AiRequest rows by day (UTC), course, mode and model. Failure = status FAILED. */
export async function getUsage(user: Principal, query: z.infer<typeof usageQuerySchema>) {
  assertCan(user, "admin:ai_usage:read");
  const from = query.from ?? new Date(Date.now() - 30 * 86_400_000);
  const to = query.to ?? new Date(Date.now() + 86_400_000);
  const courseFilter = query.courseId
    ? Prisma.sql`AND "courseId" = ${query.courseId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RawUsage[]>(Prisma.sql`
    SELECT date_trunc('day', "createdAt") AS day,
           "courseId",
           "mode"::text AS mode,
           "model",
           COUNT(*) AS requests,
           SUM("inputTokens") AS "inputTokens",
           SUM("cachedTokens") AS "cachedTokens",
           SUM("outputTokens") AS "outputTokens",
           SUM("costUsd") AS "costUsd",
           COUNT(*) FILTER (WHERE "status" = 'FAILED') AS failures,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE "latencyMs" IS NOT NULL) AS p95
    FROM "AiRequest"
    WHERE "createdAt" >= ${from} AND "createdAt" < ${to} ${courseFilter}
    GROUP BY 1, 2, 3, 4
    ORDER BY 1 DESC, 2, 3, 4
    LIMIT ${query.limit}
  `);

  const courseIds = [...new Set(rows.map((r) => r.courseId).filter((c): c is string => !!c))];
  const courses = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    select: { id: true, code: true },
  });
  const codeById = new Map(courses.map((c) => [c.id, c.code]));

  const out: UsageRow[] = rows.map((r) => {
    const requests = Number(r.requests);
    const failures = Number(r.failures);
    return {
      day: r.day.toISOString().slice(0, 10),
      courseId: r.courseId,
      courseCode: r.courseId ? (codeById.get(r.courseId) ?? null) : null,
      mode: r.mode,
      model: r.model,
      requests,
      inputTokens: Number(r.inputTokens ?? 0),
      cachedTokens: Number(r.cachedTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      costUsd: Number(r.costUsd ?? 0),
      failures,
      failureRate: requests > 0 ? failures / requests : null,
      p95LatencyMs: r.p95 === null ? null : Math.round(Number(r.p95)),
    };
  });

  const totals = out.reduce(
    (t, r) => ({
      requests: t.requests + r.requests,
      inputTokens: t.inputTokens + r.inputTokens,
      cachedTokens: t.cachedTokens + r.cachedTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      costUsd: t.costUsd + r.costUsd,
      failures: t.failures + r.failures,
    }),
    { requests: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0, failures: 0 },
  );
  return { from, to, rows: out, totals };
}
