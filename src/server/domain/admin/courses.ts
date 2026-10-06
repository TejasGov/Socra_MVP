import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";

export const LANGUAGES = ["PYTHON", "JAVASCRIPT", "SCALA"] as const;

export const courseInputSchema = z.object({
  code: z.string().trim().min(2).max(40),
  title: z.string().trim().min(2).max(200),
  term: z.string().trim().min(2).max(60),
  description: z.string().trim().max(2000).optional().nullable(),
  languages: z.array(z.enum(LANGUAGES)).min(1, "Choose at least one language"),
  timezone: z.string().trim().min(3).max(60).optional(),
  isActive: z.boolean().optional(),
});
export type CourseInput = z.infer<typeof courseInputSchema>;
export const courseUpdateSchema = courseInputSchema.partial();

export async function listCourses(user: Principal) {
  assertCan(user, "course:manage");
  const courses = await prisma.course.findMany({
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
    include: {
      memberships: {
        where: { status: "ACTIVE", role: { in: ["INSTRUCTOR", "TA"] } },
        select: {
          id: true,
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { role: "desc" },
      },
      _count: { select: { assignments: true } },
    },
  });
  const studentCounts = await prisma.courseMembership.groupBy({
    by: ["courseId"],
    where: { status: "ACTIVE", role: "STUDENT" },
    _count: { _all: true },
  });
  const byCourse = new Map(studentCounts.map((s) => [s.courseId, s._count._all]));
  return courses.map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    term: c.term,
    description: c.description,
    languages: c.languages,
    timezone: c.timezone,
    isActive: c.isActive,
    assignmentCount: c._count.assignments,
    studentCount: byCourse.get(c.id) ?? 0,
    staff: c.memberships.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  }));
}

export async function createCourse(user: Principal, input: CourseInput) {
  assertCan(user, "course:manage");
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        code: input.code,
        title: input.title,
        term: input.term,
        description: input.description ?? null,
        languages: input.languages,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "course.create",
        targetType: "Course",
        targetId: course.id,
        courseId: course.id,
        metadata: { code: course.code, term: course.term, languages: course.languages },
      },
      tx,
    );
    return course;
  });
}

export async function updateCourse(
  user: Principal,
  courseId: string,
  input: z.infer<typeof courseUpdateSchema>,
) {
  assertCan(user, "course:manage");
  return prisma.$transaction(async (tx) => {
    const before = await tx.course.findUnique({ where: { id: courseId } });
    if (!before) throw new HttpError(404, "course_not_found", "Course not found");
    const data: Prisma.CourseUpdateInput = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of [
      "code",
      "title",
      "term",
      "description",
      "languages",
      "timezone",
      "isActive",
    ] as const) {
      const next = input[key];
      if (next === undefined) continue;
      if (JSON.stringify(next) === JSON.stringify(before[key])) continue;
      (data as Record<string, unknown>)[key] = next;
      changed[key] = { from: before[key], to: next };
    }
    if (input.isActive === false && before.isActive) data.archivedAt = new Date();
    if (input.isActive === true && !before.isActive) data.archivedAt = null;
    if (Object.keys(changed).length === 0) return before;
    const course = await tx.course.update({ where: { id: courseId }, data });
    await writeAudit(
      {
        actorId: user.id,
        action: "course.update",
        targetType: "Course",
        targetId: courseId,
        courseId,
        metadata: changed as Prisma.InputJsonValue,
      },
      tx,
    );
    return course;
  });
}

export const staffInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["INSTRUCTOR", "TA"]),
});

/** Add an existing user as course instructor/TA (or change their course role). */
export async function addCourseStaff(
  user: Principal,
  courseId: string,
  input: z.infer<typeof staffInputSchema>,
) {
  assertCan(user, "course:manage");
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!course) throw new HttpError(404, "course_not_found", "Course not found");
    const target = await tx.user.findUnique({ where: { email: input.email } });
    if (!target || !target.isActive) {
      throw new HttpError(
        404,
        "user_not_found",
        "No active user has that email. Import them through the roster first.",
      );
    }
    const existing = await tx.courseMembership.findUnique({
      where: { userId_courseId: { userId: target.id, courseId } },
    });
    const membership = await tx.courseMembership.upsert({
      where: { userId_courseId: { userId: target.id, courseId } },
      create: { userId: target.id, courseId, role: input.role },
      update: { role: input.role, status: "ACTIVE" },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "course.staff_add",
        targetType: "CourseMembership",
        targetId: membership.id,
        courseId,
        metadata: {
          userId: target.id,
          role: input.role,
          previousRole: existing?.role ?? null,
          previousStatus: existing?.status ?? null,
        },
      },
      tx,
    );
    return { membershipId: membership.id, userId: target.id, role: membership.role };
  });
}

/** Remove an instructor/TA (membership becomes DROPPED; history is preserved). */
export async function removeCourseStaff(user: Principal, courseId: string, userId: string) {
  assertCan(user, "course:manage");
  return prisma.$transaction(async (tx) => {
    const m = await tx.courseMembership.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (!m || m.status !== "ACTIVE" || m.role === "STUDENT") {
      throw new HttpError(404, "staff_not_found", "That user is not active course staff");
    }
    if (m.role === "INSTRUCTOR") {
      const others = await tx.courseMembership.count({
        where: { courseId, role: "INSTRUCTOR", status: "ACTIVE", NOT: { userId } },
      });
      if (others === 0) {
        throw new HttpError(
          409,
          "last_instructor",
          "A course needs at least one instructor. Add another first.",
        );
      }
    }
    await tx.courseMembership.update({ where: { id: m.id }, data: { status: "DROPPED" } });
    await writeAudit(
      {
        actorId: user.id,
        action: "course.staff_remove",
        targetType: "CourseMembership",
        targetId: m.id,
        courseId,
        metadata: { userId, role: m.role },
      },
      tx,
    );
    return { removed: true };
  });
}
