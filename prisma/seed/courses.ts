import type { CourseRole, ProgrammingLanguage } from "@/generated/prisma/enums";
import { sid, type SeedContext } from "./context";
import { STUDENT_COUNT } from "./users";

export const TERM = "Fall 2026";

export interface SeedCourse {
  key: "cse115" | "cse116";
  code: string;
  title: string;
  description: string;
  languages: ProgrammingLanguage[];
  sections: Array<{ code: string; name: string }>;
}

export const COURSES: SeedCourse[] = [
  {
    key: "cse115",
    code: "CSE 115",
    title: "Introduction to Computer Science I",
    description: "Variables, control flow, functions, lists and an introduction to recursion.",
    languages: ["PYTHON", "JAVASCRIPT"],
    sections: [
      { code: "A1", name: "Section A1" },
      { code: "A2", name: "Section A2" },
    ],
  },
  {
    key: "cse116",
    code: "CSE 116",
    title: "Introduction to Computer Science II",
    description: "Recursion, asymptotic complexity, linked structures, trees and traversal.",
    languages: ["PYTHON", "SCALA"],
    sections: [{ code: "B1", name: "Section B1" }],
  },
];

/**
 * Enrollment plan (deterministic):
 *   CSE 115: students 1-20 (A1: 1-10, A2: 11-20), faculty (INSTRUCTOR), ta (TA)
 *   CSE 116: students 1-3 and 11-30 (B1), faculty + faculty2 (INSTRUCTOR), ta (TA)
 * student1..3 are therefore enrolled in both courses.
 */
export function enrollmentPlan(): Array<{
  userKey: string;
  courseKey: SeedCourse["key"];
  role: CourseRole;
  section?: string;
}> {
  const plan: Array<{
    userKey: string;
    courseKey: SeedCourse["key"];
    role: CourseRole;
    section?: string;
  }> = [];
  for (let i = 1; i <= STUDENT_COUNT; i++) {
    if (i <= 20)
      plan.push({
        userKey: `student${i}`,
        courseKey: "cse115",
        role: "STUDENT",
        section: i <= 10 ? "A1" : "A2",
      });
    if (i <= 3 || i >= 11)
      plan.push({ userKey: `student${i}`, courseKey: "cse116", role: "STUDENT", section: "B1" });
  }
  plan.push({ userKey: "faculty", courseKey: "cse115", role: "INSTRUCTOR" });
  plan.push({ userKey: "faculty", courseKey: "cse116", role: "INSTRUCTOR" });
  plan.push({ userKey: "faculty2", courseKey: "cse116", role: "INSTRUCTOR" });
  plan.push({ userKey: "ta", courseKey: "cse115", role: "TA" });
  plan.push({ userKey: "ta", courseKey: "cse116", role: "TA" });
  return plan;
}

export async function seedCourses(ctx: SeedContext): Promise<void> {
  for (const c of COURSES) {
    const id = sid("course", c.key);
    const course = await ctx.prisma.course.upsert({
      where: { id },
      create: {
        id,
        code: c.code,
        title: c.title,
        term: TERM,
        description: c.description,
        languages: c.languages,
      },
      update: {
        code: c.code,
        title: c.title,
        term: TERM,
        description: c.description,
        languages: c.languages,
        isActive: true,
      },
    });
    ctx.ids.courses[c.key] = course.id;
    for (const s of c.sections) {
      await ctx.prisma.courseSection.upsert({
        where: { courseId_code: { courseId: course.id, code: s.code } },
        create: {
          id: sid("section", c.key, s.code),
          courseId: course.id,
          code: s.code,
          name: s.name,
        },
        update: { name: s.name },
      });
    }
  }

  const plan = enrollmentPlan();
  for (const e of plan) {
    const userId = ctx.ids.users[e.userKey];
    const courseId = ctx.ids.courses[e.courseKey];
    if (!userId || !courseId)
      throw new Error(`seedCourses: missing user/course for ${e.userKey}/${e.courseKey}`);
    const sectionId = e.section ? sid("section", e.courseKey, e.section) : null;
    await ctx.prisma.courseMembership.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, role: e.role, sectionId, status: "ACTIVE" },
      update: { role: e.role, sectionId, status: "ACTIVE" },
    });
  }
  ctx.log(`courses: ${COURSES.length}, memberships: ${plan.length}`);
}
