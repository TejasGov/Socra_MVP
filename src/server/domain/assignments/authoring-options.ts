import "server-only";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";

export interface AuthoringCourse {
  id: string;
  code: string;
  title: string;
  topics: Array<{ key: string; name: string }>;
  resources: Array<{ id: string; title: string }>;
}

/** Courses where the user is an instructor, with the topic and resource choices the authoring form offers. */
export async function listAuthoringCourses(user: CurrentUser): Promise<AuthoringCourse[]> {
  const ids = user.memberships
    .filter((m) => m.status === "ACTIVE" && m.role === "INSTRUCTOR")
    .map((m) => m.courseId);
  if (ids.length === 0) return [];
  const courses = await prisma.course.findMany({
    where: { id: { in: ids }, isActive: true },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      title: true,
      topics: { orderBy: [{ order: "asc" }, { name: "asc" }], select: { key: true, name: true } },
      resources: {
        where: { status: { notIn: ["FAILED", "ARCHIVED"] } },
        orderBy: { title: "asc" },
        select: { id: true, title: true },
      },
    },
  });
  return courses;
}
