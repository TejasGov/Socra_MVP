import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { assertCan, MIN_PRIVILEGED_REASON_LENGTH, type Principal } from "@/server/auth/rbac";
import { ensureResearchMapping, pseudonymFor, writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";

export const CONDITIONS = ["CONTROL", "UNRESTRICTED_AI", "SOCRATIC_AI"] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * Participants as the research console sees them: pseudonymous ID and study fields only. No name, no email, no user id.
 */
export async function listParticipants(
  user: Principal,
  opts: { courseId?: string; page?: number; pageSize?: number } = {},
) {
  assertCan(user, "research:read");
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, opts.pageSize ?? 50);
  const where = opts.courseId ? { courseId: opts.courseId } : {};
  const [total, rows, grouped, courses] = await Promise.all([
    prisma.studyParticipant.count({ where }),
    prisma.studyParticipant.findMany({
      where,
      orderBy: [{ courseId: "asc" }, { pseudonymousId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        courseId: true,
        pseudonymousId: true,
        condition: true,
        consentStatus: true,
        conditionLocked: true,
        assignmentMethod: true,
        assignedAt: true,
        withdrawnAt: true,
        course: { select: { code: true } },
        _count: { select: { changes: true } },
      },
    }),
    prisma.studyParticipant.groupBy({
      by: ["courseId", "condition"],
      where,
      _count: { _all: true },
    }),
    prisma.course.findMany({
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const codeById = new Map(courses.map((c) => [c.id, c.code]));
  return {
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    courses,
    balance: grouped.map((g) => ({
      courseId: g.courseId,
      courseCode: codeById.get(g.courseId) ?? g.courseId,
      condition: g.condition,
      count: g._count._all,
    })),
    participants: rows.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      courseCode: r.course.code,
      pseudonymousId: r.pseudonymousId,
      condition: r.condition,
      consentStatus: r.consentStatus,
      conditionLocked: r.conditionLocked,
      assignmentMethod: r.assignmentMethod,
      assignedAt: r.assignedAt,
      withdrawnAt: r.withdrawnAt,
      changeCount: r._count.changes,
    })),
  };
}

export const conditionChangeSchema = z.object({
  toCondition: z.enum(CONDITIONS),
  reason: z
    .string()
    .trim()
    .min(MIN_PRIVILEGED_REASON_LENGTH, "Give a specific reason (10+ characters)")
    .max(1000),
});

/**
 * Change a participant's study condition. Never silent: a reason is required, a StudyConditionChange row is written,
 * and an audit entry and research event are written in the same transaction.
 */
export async function changeParticipantCondition(
  user: Principal,
  participantId: string,
  input: z.infer<typeof conditionChangeSchema>,
) {
  assertCan(user, "research:condition:manage");
  return prisma.$transaction(async (tx) => {
    const p = await tx.studyParticipant.findUnique({ where: { id: participantId } });
    if (!p) throw new HttpError(404, "participant_not_found", "Participant not found");
    if (p.withdrawnAt) {
      throw new HttpError(409, "participant_withdrawn", "This participant has withdrawn");
    }
    if (p.condition === input.toCondition) {
      throw new HttpError(409, "same_condition", "The participant is already in that condition");
    }
    const change = await tx.studyConditionChange.create({
      data: {
        participantId: p.id,
        fromCondition: p.condition,
        toCondition: input.toCondition,
        reason: input.reason,
        changedById: user.id,
      },
    });
    await tx.studyParticipant.update({
      where: { id: p.id },
      data: { condition: input.toCondition, conditionLocked: true },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "research.condition_change",
        targetType: "StudyParticipant",
        targetId: p.id,
        courseId: p.courseId,
        reason: input.reason,
        metadata: {
          changeId: change.id,
          pseudonymousId: p.pseudonymousId,
          from: p.condition,
          to: input.toCondition,
        },
      },
      tx,
    );
    // The event is attributed to the participant (so its pseudonymous id and condition are correct), not to the admin.
    await writeEvent(tx, {
      eventName: "research_condition_changed",
      actorId: p.userId,
      courseId: p.courseId,
      idempotencyKey: `research_condition_changed:${change.id}`,
      researchCondition: input.toCondition,
      metadata: { fromCondition: p.condition, toCondition: input.toCondition },
    });
    return { participantId: p.id, from: p.condition, to: input.toCondition, changeId: change.id };
  });
}

export const enrollSchema = z.object({ courseId: z.string().min(1) });

/**
 * Enrol every active student of a course who is not yet a participant. Conditions are assigned to keep the three
 * arms balanced (always the least-populated arm; ties broken by pseudonymous id order, so the result is deterministic).
 */
export async function enrollCourseParticipants(
  user: Principal,
  input: z.infer<typeof enrollSchema>,
) {
  assertCan(user, "research:condition:manage");
  return prisma.$transaction(
    async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: input.courseId },
        select: { id: true },
      });
      if (!course) throw new HttpError(404, "course_not_found", "Course not found");
      const students = await tx.courseMembership.findMany({
        where: {
          courseId: input.courseId,
          role: "STUDENT",
          status: "ACTIVE",
          user: { isActive: true },
        },
        select: { userId: true },
      });
      const existing = await tx.studyParticipant.findMany({
        where: { courseId: input.courseId },
        select: { userId: true, condition: true },
      });
      const have = new Set(existing.map((e) => e.userId));
      const counts: Record<Condition, number> = { CONTROL: 0, UNRESTRICTED_AI: 0, SOCRATIC_AI: 0 };
      for (const e of existing) counts[e.condition]++;
      const fresh = students
        .filter((s) => !have.has(s.userId))
        .map((s) => ({ userId: s.userId, pseudonym: pseudonymFor(s.userId) }))
        .sort((a, b) => a.pseudonym.localeCompare(b.pseudonym));

      const assigned: Record<Condition, number> = {
        CONTROL: 0,
        UNRESTRICTED_AI: 0,
        SOCRATIC_AI: 0,
      };
      for (const s of fresh) {
        const condition = [...CONDITIONS].sort((a, b) => counts[a] - counts[b])[0]!;
        counts[condition]++;
        assigned[condition]++;
        const participantId = await ensureResearchMapping(s.userId, tx);
        await tx.studyParticipant.create({
          data: {
            userId: s.userId,
            courseId: input.courseId,
            pseudonymousId: participantId,
            condition,
            assignedById: user.id,
            assignmentMethod: "balanced-least-populated-v1",
          },
        });
        await writeEvent(tx, {
          eventName: "research_condition_assigned",
          actorId: s.userId,
          courseId: input.courseId,
          idempotencyKey: `research_condition_assigned:${input.courseId}:${s.userId}`,
          researchCondition: condition,
          metadata: { condition, method: "balanced-least-populated-v1" },
        });
      }
      await writeAudit(
        {
          actorId: user.id,
          action: "research.condition_assign",
          targetType: "Course",
          targetId: input.courseId,
          courseId: input.courseId,
          metadata: { enrolled: fresh.length, assigned, method: "balanced-least-populated-v1" },
        },
        tx,
      );
      return { enrolled: fresh.length, assigned };
    },
    { timeout: 60_000 },
  );
}
