import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type DbOrTx } from "../db";

/**
 * Append-only audit log (PRD §27.2). The AuditLog table rejects UPDATE/DELETE at the database level
 * (trigger in migration 20261006064100_search_indexes_and_guards).
 *
 * Use the same `tx` as the privileged mutation so the audit row commits atomically with it.
 */

/** Canonical audit action names. Extend as needed (string literal union keeps call sites consistent). */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "assignment.create"
  | "assignment.update"
  | "assignment.publish"
  | "assignment.close"
  | "assignment.reopen"
  | "assignment.archive"
  | "assignment.solutions_release"
  | "grade.finalize"
  | "grade.override"
  | "role.change"
  | "user.deactivate"
  | "roster.import"
  | "roster.change"
  | "research.export"
  | "research.condition_change"
  | "research.reidentify"
  | "transcript.read_raw"
  | "grant.create"
  | "grant.revoke"
  | "flag.update"
  | "ai_config.update"
  | "ai_budget.update"
  | "policy.update"
  | "retention.run"
  | "training.dataset_export"
  | (string & {});

export interface AuditInput {
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  courseId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(input: AuditInput, db: DbOrTx = prisma): Promise<{ id: string }> {
  return db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      courseId: input.courseId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    },
    select: { id: true },
  });
}
