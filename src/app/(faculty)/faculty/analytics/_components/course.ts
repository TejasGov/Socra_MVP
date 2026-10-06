import "server-only";
import { AuthError } from "@/server/auth/rbac";
import type { CurrentUser } from "@/server/auth/current-user";
import { listStaffCourses } from "@/server/domain/analytics";

/** Course for a faculty analytics page: `?courseId=` if the user is staff there, else their first course. */
export async function pickCourse(user: CurrentUser, courseId: string | undefined) {
  const courses = await listStaffCourses(user);
  const course = courses.find((c) => c.id === courseId) ?? courses[0] ?? null;
  return { course, courses };
}

/** Map a thrown authorization error to plain copy for an ErrorState. */
export function analyticsErrorMessage(err: unknown): string | null {
  if (err instanceof AuthError) {
    if (err.code === "feature_disabled") return "Faculty analytics is turned off for this course.";
    if (err.status === 404) return "This item does not exist or was removed.";
    return "Your role in this course does not include class analytics.";
  }
  return null;
}
