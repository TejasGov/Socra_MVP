import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { transition } from "@/server/domain/assignments/state-machine";

/**
 * Operational close / reopen from the admin console (PRD §31).
 *
 * C's assignment service (src/server/domain/assignments) currently exposes only the pure state machine
 * (`transition`), so this module reuses that and persists the change itself. If C later ships a service function,
 * swap the body of `adminSetAssignmentState` for it; the audit entry and event written here stay the contract.
 */

export const adminAssignmentActionSchema = z.object({
  action: z.enum(["close", "reopen"]),
  reason: z.string().trim().min(5, "Give a short reason").max(500),
  /** Reopen only: new close time. When the existing close time has passed and none is given, it is cleared. */
  closeAt: z.coerce.date().optional(),
});

export async function listAssignmentsForAdmin(user: Principal, courseId?: string) {
  assertCan(user, "course:manage");
  const rows = await prisma.assignment.findMany({
    where: {
      ...(courseId ? { courseId } : {}),
      state: { in: ["PUBLISHED_PROTECTED", "CLOSED", "SCHEDULED"] },
    },
    orderBy: [{ courseId: "asc" }, { dueAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      state: true,
      dueAt: true,
      closeAt: true,
      courseId: true,
      course: { select: { code: true } },
    },
  });
  return rows;
}

export async function adminSetAssignmentState(
  user: Principal,
  assignmentId: string,
  input: z.infer<typeof adminAssignmentActionSchema>,
) {
  const head = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true },
  });
  if (!head) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, input.action === "close" ? "assignment:close" : "assignment:reopen", {
    courseId: head.courseId,
  });

  return prisma.$transaction(async (tx) => {
    const a = await tx.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { currentVersion: { select: { version: true } } },
    });
    const t = transition(a.state, input.action, { solutionsReleased: a.solutionsReleased });
    if (!t.ok) throw new HttpError(409, "invalid_transition", t.reason);
    const now = new Date();
    const closeAt =
      input.action === "reopen"
        ? (input.closeAt ?? (a.closeAt && a.closeAt <= now ? null : a.closeAt))
        : a.closeAt;
    await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        state: t.state,
        closedAt: input.action === "close" ? now : null,
        closeAt,
        ...(t.effects.solutionsReleased === false
          ? { solutionsReleased: false, solutionsReleasedAt: null }
          : {}),
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: input.action === "close" ? "assignment.close" : "assignment.reopen",
        targetType: "Assignment",
        targetId: assignmentId,
        courseId: a.courseId,
        reason: input.reason,
        metadata: { from: a.state, to: t.state, via: "admin_console" },
      },
      tx,
    );
    await writeEvent(tx, {
      eventName: input.action === "close" ? "assignment_closed" : "assignment_reopened",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId,
      assignmentVersion: a.currentVersion?.version ?? null,
      idempotencyKey: `assignment_${input.action}:${assignmentId}:${now.getTime()}`,
      metadata: input.action === "close" ? { trigger: "admin" as const } : { reason: input.reason },
    });
    return { assignmentId, state: t.state };
  });
}
