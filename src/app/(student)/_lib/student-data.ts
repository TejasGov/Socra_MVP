import "server-only";
import type { CurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  listAssignmentsForStudent,
  listCoursesForUser,
  type AssignmentCard,
  type CourseSummary,
} from "@/server/domain/assignments/queries";

/** Courses where the user is enrolled as a student (C's listCoursesForUser, filtered by role). */
export async function studentCourses(user: CurrentUser): Promise<CourseSummary[]> {
  const all = await listCoursesForUser(user);
  return all.filter((c) => c.role === "STUDENT");
}

export interface CardWithCourse extends AssignmentCard {
  courseCode: string;
}

/** All visible assignments across the student's courses (C's listAssignmentsForStudent per course). */
export async function allAssignments(
  user: CurrentUser,
  courses: CourseSummary[],
): Promise<CardWithCourse[]> {
  const lists = await Promise.all(
    courses.map(async (c) =>
      (await listAssignmentsForStudent(user, c.id)).map((a) => ({ ...a, courseCode: c.code })),
    ),
  );
  return lists.flat();
}

export interface RecentSocraSession {
  id: string;
  title: string;
  kind: string;
  href: string | null;
  lastActivityAt: Date;
  startedAt: Date;
  status: string;
  courseCode: string;
}

const SESSION_STATUS: Record<string, string> = {
  ACTIVE: "In progress",
  ENDED: "Completed",
  LIMIT_REACHED: "Help limit reached",
  ESCALATED: "Referred to TA",
};

/**
 * TRIVIAL READ (Agent F, owned by Agent A's AiSession table): the student's own recent Socra
 * sessions, titles and dates only. Never selects message content or summaries.
 */
export async function recentSocraSessions(
  user: CurrentUser,
  take = 5,
  kind: "all" | "assignment" | "practice" = "all",
): Promise<RecentSocraSession[]> {
  const modes =
    kind === "practice"
      ? (["PRACTICE"] as const)
      : kind === "assignment"
        ? (["PROTECTED_ASSESSMENT", "POST_ASSESSMENT_REVIEW"] as const)
        : (["PROTECTED_ASSESSMENT", "PRACTICE", "POST_ASSESSMENT_REVIEW"] as const);
  const rows = await prisma.aiSession.findMany({
    where: { userId: user.id, mode: { in: [...modes] } },
    orderBy: { lastActivityAt: "desc" },
    take,
    select: {
      id: true,
      mode: true,
      status: true,
      startedAt: true,
      lastActivityAt: true,
      course: { select: { code: true } },
      assignment: { select: { id: true, title: true, courseId: true } },
      practiceSession: { select: { id: true, topic: { select: { name: true } } } },
    },
  });
  return rows.map((r) => {
    const base = {
      id: r.id,
      lastActivityAt: r.lastActivityAt,
      startedAt: r.startedAt,
      status: SESSION_STATUS[r.status] ?? r.status,
      courseCode: r.course.code,
    };
    if (r.assignment) {
      return {
        ...base,
        title: r.assignment.title,
        kind: r.mode === "POST_ASSESSMENT_REVIEW" ? "Assignment review" : "Assignment help",
        href: `/courses/${r.assignment.courseId}/assignments/${r.assignment.id}`,
      };
    }
    if (r.practiceSession) {
      return {
        ...base,
        title: r.practiceSession.topic ? `Practice: ${r.practiceSession.topic.name}` : "Practice: mixed topics",
        kind: "Practice",
        href: `/practice/${r.practiceSession.id}`,
      };
    }
    return {
      ...base,
      title: "Socra session",
      kind: r.mode === "PRACTICE" ? "Practice" : "Assignment help",
      href: null,
    };
  });
}

/** Practice link for a topic (Agent G's /practice reads courseId and topicId). */
export function practiceHref(courseId: string, topicId?: string): string {
  const p = new URLSearchParams({ courseId });
  if (topicId) p.set("topicId", topicId);
  return `/practice?${p.toString()}`;
}

export function assignmentHref(a: { courseId: string; id: string }): string {
  return `/courses/${a.courseId}/assignments/${a.id}`;
}
