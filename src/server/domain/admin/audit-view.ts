import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { assertCan, type Principal } from "@/server/auth/rbac";

export const auditQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  actorEmail: z.string().trim().max(200).optional(),
  targetType: z.string().trim().max(80).optional(),
  courseId: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

export async function listAuditLog(user: Principal, query: z.infer<typeof auditQuerySchema>) {
  assertCan(user, "admin:audit:read");
  const where: Prisma.AuditLogWhereInput = {};
  if (query.action) where.action = { contains: query.action, mode: "insensitive" };
  if (query.targetType) where.targetType = query.targetType;
  if (query.courseId) where.courseId = query.courseId;
  if (query.actorEmail) {
    where.actor = { email: { contains: query.actorEmail, mode: "insensitive" } };
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lt: query.to } : {}),
    };
  }
  const [total, rows, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { actor: { select: { email: true, name: true } } },
    }),
    prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    actions: actions.map((a) => a.action),
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      actorEmail: r.actor?.email ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      courseId: r.courseId,
      reason: r.reason,
      metadata: r.metadata,
    })),
  };
}
