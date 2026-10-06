import "server-only";
import type { CourseRole, ProgrammingLanguage } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";
import { activeMembership, can } from "@/server/auth/rbac";
import { recordEvent } from "@/server/events";
import { syncAssignmentState, syncCourseAssignments } from "./service";
import {
  acceptsSubmissions,
  PROGRESS_LABELS,
  studentMode,
  visibleToStudents,
  type AssignmentState,
  type ProgressStatus,
  type StudentMode,
} from "./state-machine";
import { testCaseToSpec, type TestCaseRow } from "./test-mapping";

/**
 * Student-facing assignment queries (contract: docs/_CONTRACTS.md).
 *
 * Every query uses an explicit `select`. Hidden and diagnostic tests, answer keys and (outside review mode)
 * reference solutions are never selected, so they cannot leak by accident through a later field addition.
 */

export const MODE_LABELS: Record<StudentMode, string> = {
  PROTECTED_ASSESSMENT: "Protected assistance",
  POST_ASSESSMENT_REVIEW: "Review mode",
};

const day = (d = new Date()) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------------------------

export interface CourseSummary {
  id: string;
  code: string;
  title: string;
  term: string;
  languages: ProgrammingLanguage[];
  role: CourseRole;
}

export async function listCoursesForUser(user: CurrentUser): Promise<CourseSummary[]> {
  const active = user.memberships.filter((m) => m.status === "ACTIVE");
  if (active.length === 0) return [];
  const courses = await prisma.course.findMany({
    where: { id: { in: active.map((m) => m.courseId) }, isActive: true, archivedAt: null },
    select: { id: true, code: true, title: true, term: true, languages: true },
    orderBy: { code: "asc" },
  });
  return courses.map((c) => ({
    ...c,
    role: active.find((m) => m.courseId === c.id)!.role,
  }));
}

export interface CourseDetail extends CourseSummary {
  description: string | null;
  assignments: AssignmentCard[];
}

export async function getCourseForUser(
  user: CurrentUser,
  courseId: string,
): Promise<CourseDetail | null> {
  const membership = activeMembership(user, courseId);
  if (!membership) return null;
  const course = await prisma.course.findFirst({
    where: { id: courseId, isActive: true },
    select: { id: true, code: true, title: true, term: true, languages: true, description: true },
  });
  if (!course) return null;
  await recordEvent({
    eventName: "course_opened",
    actorId: user.id,
    courseId,
    idempotencyKey: `course_opened:${user.sessionId || user.id}:${courseId}:${day()}`,
    metadata: {},
  });
  const assignments = await listAssignmentsForStudent(user, courseId);
  return { ...course, role: membership.role, assignments };
}

// ---------------------------------------------------------------------------------------------------------------
// Assignment cards (PRD §10.2)
// ---------------------------------------------------------------------------------------------------------------

export interface AssignmentCard {
  id: string;
  courseId: string;
  title: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  language: ProgrammingLanguage | null;
  state: AssignmentState;
  openAt: Date | null;
  dueAt: Date | null;
  closeAt: Date | null;
  /** Optional estimated completion time; not yet authored in V1. */
  estimatedMinutes: number | null;
  totalPoints: number;
  questionCount: number;
  progressStatus: ProgressStatus;
  progressLabel: string;
  attemptsUsed: number;
  attemptLimit: number | null;
  /** Present only after a grade has been released to the student. */
  score: { points: number; maxPoints: number } | null;
  mode: StudentMode;
  modeLabel: string;
  isClosed: boolean;
  isOverdue: boolean;
}

export async function listAssignmentsForStudent(
  user: CurrentUser,
  courseId: string,
): Promise<AssignmentCard[]> {
  if (!activeMembership(user, courseId)) return [];
  await syncCourseAssignments(courseId);
  const staff = can(user, "assignment:read_staff", { courseId });
  const rows = await prisma.assignment.findMany({
    where: {
      courseId,
      state: staff
        ? { in: ["PUBLISHED_PROTECTED", "CLOSED", "SCHEDULED", "DRAFT"] }
        : { in: ["PUBLISHED_PROTECTED", "CLOSED"] },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      courseId: true,
      title: true,
      format: true,
      language: true,
      state: true,
      openAt: true,
      dueAt: true,
      closeAt: true,
      totalPoints: true,
      attemptLimit: true,
      solutionsReleased: true,
      _count: { select: { questions: true } },
      progress: {
        where: { userId: user.id },
        select: { status: true, attemptsUsed: true },
        take: 1,
      },
    },
  });
  const ids = rows.map((r) => r.id);
  const grades =
    ids.length === 0
      ? []
      : await prisma.grade.findMany({
          where: {
            scope: "SUBMISSION",
            releasedAt: { not: null },
            finalScore: { not: null },
            submission: { userId: user.id, assignmentId: { in: ids } },
          },
          orderBy: { submission: { attemptNumber: "desc" } },
          select: {
            finalScore: true,
            maxPoints: true,
            submission: { select: { assignmentId: true } },
          },
        });
  const now = Date.now();
  return rows.map((r) => {
    const p = r.progress[0];
    const status: ProgressStatus = (p?.status as ProgressStatus | undefined) ?? "NOT_STARTED";
    const g = grades.find((x) => x.submission.assignmentId === r.id);
    const mode = studentMode(r);
    const isClosed = r.state === "CLOSED";
    return {
      id: r.id,
      courseId: r.courseId,
      title: r.title,
      format: r.format,
      language: r.language,
      state: r.state,
      openAt: r.openAt,
      dueAt: r.dueAt,
      closeAt: r.closeAt,
      estimatedMinutes: null,
      totalPoints: r.totalPoints,
      questionCount: r._count.questions,
      progressStatus: status,
      progressLabel: PROGRESS_LABELS[status],
      attemptsUsed: p?.attemptsUsed ?? 0,
      attemptLimit: r.attemptLimit,
      score: g && g.finalScore !== null ? { points: g.finalScore, maxPoints: g.maxPoints } : null,
      mode,
      modeLabel: MODE_LABELS[mode],
      isClosed,
      isOverdue:
        !isClosed &&
        !!r.dueAt &&
        r.dueAt.getTime() < now &&
        status !== "SUBMITTED" &&
        status !== "RETURNED",
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Assignment workspace view
// ---------------------------------------------------------------------------------------------------------------

export interface PublicTestView {
  id: string;
  name: string;
  kind: "function" | "stdio";
  entryPoint?: string;
  args?: unknown[];
  expectedReturn?: unknown;
  stdin?: string;
  expectedStdout?: string;
}

export interface StudentRunSummary {
  runId: string;
  kind: "RUN" | "PUBLIC_TESTS" | "GRADING";
  status: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  /** PUBLIC tests only. */
  testResults: unknown[];
  completedAt: Date | null;
}

export interface StudentQuestionView {
  id: string;
  order: number;
  version: number;
  title: string;
  prompt: string;
  type: "CODING" | "SHORT_ANSWER" | "ESSAY" | "MULTIPLE_CHOICE";
  points: number;
  language: ProgrammingLanguage | null;
  starterCode: string | null;
  entryPoint: string | null;
  choices: string[] | null;
  publicTests: PublicTestView[];
  scaffold: Array<{ order: number; title: string; instructions: string; hint: string | null }>;
  draft: { content: string; version: number; updatedAt: Date } | null;
  latestRun: StudentRunSummary | null;
  /** Review mode only (CLOSED and released). */
  referenceSolution: string | null;
}

export interface StudentSubmissionView {
  id: string;
  attemptNumber: number;
  submittedAt: Date;
  status: string;
  isLate: boolean;
  gradeReleased: boolean;
  score: { points: number; maxPoints: number } | null;
  feedback: string | null;
}

export interface StudentAssignmentView {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  description: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  language: ProgrammingLanguage | null;
  state: AssignmentState;
  version: number | null;
  mode: StudentMode;
  modeLabel: string;
  solutionsReleased: boolean;
  openAt: Date | null;
  dueAt: Date | null;
  closeAt: Date | null;
  attemptLimit: number | null;
  attemptsUsed: number;
  allowResubmission: boolean;
  totalPoints: number;
  learningObjectives: string[];
  topics: Array<{ key: string; name: string }>;
  policy: {
    maxInterventionLevel: number;
    allowDirectSyntaxHelp: boolean;
    allowedBehaviors: string[];
    forbiddenBehaviors: string[];
  } | null;
  questions: StudentQuestionView[];
  submissions: StudentSubmissionView[];
  progressStatus: ProgressStatus;
  progressLabel: string;
  canSubmit: boolean;
  submitBlockedReason: string | null;
  /** True for staff previews: nothing the viewer does is stored as student data. */
  preview: boolean;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Student view of an assignment, or null when it does not exist or the user may not see it. */
export async function getAssignmentForStudent(
  user: CurrentUser,
  assignmentId: string,
): Promise<StudentAssignmentView | null> {
  const head = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, courseId: true },
  });
  if (!head) return null;
  const membership = activeMembership(user, head.courseId);
  if (!membership) return null;
  const staff = can(user, "assignment:preview", { courseId: head.courseId });
  if (membership.role !== "STUDENT" && !staff) return null;
  const preview = membership.role !== "STUDENT";

  const state = await syncAssignmentState(assignmentId);
  if (!preview && !visibleToStudents(state)) return null;

  const a = await prisma.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: {
      id: true,
      courseId: true,
      title: true,
      description: true,
      format: true,
      language: true,
      state: true,
      openAt: true,
      dueAt: true,
      closeAt: true,
      attemptLimit: true,
      allowResubmission: true,
      totalPoints: true,
      solutionsReleased: true,
      course: { select: { code: true } },
      currentVersion: { select: { version: true, policyVersionId: true } },
      socraPolicy: {
        select: {
          currentVersion: {
            select: {
              maxInterventionLevel: true,
              allowDirectSyntaxHelp: true,
              allowedBehaviors: true,
              forbiddenBehaviors: true,
            },
          },
        },
      },
      objectives: { select: { objective: { select: { description: true, order: true } } } },
      topics: { select: { topic: { select: { key: true, name: true } } } },
    },
  });

  const mode = studentMode(a);
  const review = mode === "POST_ASSESSMENT_REVIEW";
  const userId = preview ? null : user.id;

  const questions = await prisma.question.findMany({
    where: { assignmentId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      currentVersion: {
        select: {
          version: true,
          title: true,
          prompt: true,
          type: true,
          points: true,
          language: true,
          starterCode: true,
          entryPoint: true,
          choices: true,
          referenceSolution: review,
          testCases: {
            where: { visibility: "PUBLIC" },
            orderBy: { order: "asc" },
            select: {
              id: true,
              name: true,
              visibility: true,
              weight: true,
              input: true,
              expected: true,
              harness: true,
              timeoutMs: true,
              failureHint: true,
            },
          },
          scaffold: {
            orderBy: { order: "asc" },
            select: { order: true, title: true, instructions: true, hint: true },
          },
        },
      },
    },
  });
  const qids = questions.map((q) => q.id);

  const [drafts, runs, submissions, progress] = userId
    ? await Promise.all([
        prisma.draft.findMany({
          where: { userId, assignmentId },
          select: { questionId: true, content: true, version: true, updatedAt: true },
        }),
        prisma.codeRun.findMany({
          where: { userId, assignmentId, questionId: { in: qids }, completedAt: { not: null } },
          orderBy: { queuedAt: "desc" },
          distinct: ["questionId"],
          select: {
            id: true,
            questionId: true,
            kind: true,
            status: true,
            stdout: true,
            stderr: true,
            exitCode: true,
            durationMs: true,
            testsPassed: true,
            testsTotal: true,
            testResults: true,
            completedAt: true,
          },
        }),
        prisma.submission.findMany({
          where: { userId, assignmentId },
          orderBy: { attemptNumber: "desc" },
          select: {
            id: true,
            attemptNumber: true,
            submittedAt: true,
            status: true,
            isLate: true,
            grades: {
              where: { scope: "SUBMISSION" },
              select: { finalScore: true, maxPoints: true, releasedAt: true, feedback: true },
              take: 1,
            },
          },
        }),
        prisma.assignmentProgress.findUnique({
          where: { userId_assignmentId: { userId, assignmentId } },
          select: { status: true, attemptsUsed: true },
        }),
      ])
    : [[], [], [], null];

  const attemptsUsed = submissions.length;
  const progressStatus: ProgressStatus =
    (progress?.status as ProgressStatus | undefined) ?? "NOT_STARTED";

  let submitBlockedReason: string | null = null;
  if (preview) submitBlockedReason = "Preview. Submissions are disabled.";
  else if (!acceptsSubmissions({ state: a.state, openAt: a.openAt, closeAt: a.closeAt }))
    submitBlockedReason =
      a.state === "CLOSED"
        ? "This assignment is closed."
        : "This assignment is not open for submissions.";
  else if (a.attemptLimit !== null && attemptsUsed >= a.attemptLimit)
    submitBlockedReason = "You have used every attempt.";
  else if (!a.allowResubmission && attemptsUsed >= 1)
    submitBlockedReason = "Resubmission is not allowed for this assignment.";

  const view: StudentAssignmentView = {
    id: a.id,
    courseId: a.courseId,
    courseCode: a.course.code,
    title: a.title,
    description: a.description,
    format: a.format,
    language: a.language,
    state: a.state,
    version: a.currentVersion?.version ?? null,
    mode,
    modeLabel: MODE_LABELS[mode],
    solutionsReleased: a.solutionsReleased,
    openAt: a.openAt,
    dueAt: a.dueAt,
    closeAt: a.closeAt,
    attemptLimit: a.attemptLimit,
    attemptsUsed,
    allowResubmission: a.allowResubmission,
    totalPoints: a.totalPoints,
    learningObjectives: a.objectives
      .sort((x, y) => x.objective.order - y.objective.order)
      .map((o) => o.objective.description),
    topics: a.topics.map((t) => t.topic),
    policy: a.socraPolicy?.currentVersion
      ? {
          maxInterventionLevel: a.socraPolicy.currentVersion.maxInterventionLevel,
          allowDirectSyntaxHelp: a.socraPolicy.currentVersion.allowDirectSyntaxHelp,
          allowedBehaviors: asStringArray(a.socraPolicy.currentVersion.allowedBehaviors),
          forbiddenBehaviors: asStringArray(a.socraPolicy.currentVersion.forbiddenBehaviors),
        }
      : null,
    questions: questions
      .filter((q) => q.currentVersion)
      .map((q) => {
        const v = q.currentVersion!;
        const draft = drafts.find((d) => d.questionId === q.id);
        const run = runs.find((r) => r.questionId === q.id);
        return {
          id: q.id,
          order: q.order,
          version: v.version,
          title: v.title,
          prompt: v.prompt,
          type: v.type,
          points: v.points,
          language: v.language,
          starterCode: v.starterCode,
          entryPoint: v.entryPoint,
          choices: Array.isArray(v.choices) ? asStringArray(v.choices) : null,
          publicTests: v.testCases
            .filter((t) => t.visibility === "PUBLIC")
            .map((t) => {
              const s = testCaseToSpec(t as unknown as TestCaseRow, v.entryPoint);
              return {
                id: s.id,
                name: s.name,
                kind: s.kind,
                entryPoint: s.entryPoint,
                args: s.args,
                expectedReturn: s.expectedReturn,
                stdin: s.stdin,
                expectedStdout: s.expectedStdout,
              };
            }),
          scaffold: v.scaffold,
          draft: draft
            ? { content: draft.content, version: draft.version, updatedAt: draft.updatedAt }
            : null,
          latestRun: run
            ? {
                runId: run.id,
                kind: run.kind,
                status: run.status,
                stdout: run.stdout ?? "",
                stderr: run.stderr ?? "",
                exitCode: run.exitCode,
                durationMs: run.durationMs,
                testsPassed: run.testsPassed,
                testsTotal: run.testsTotal,
                testResults: (Array.isArray(run.testResults) ? run.testResults : []).filter(
                  (t) => (t as { visibility?: string }).visibility === "PUBLIC",
                ),
                completedAt: run.completedAt,
              }
            : null,
          referenceSolution: review
            ? ((v as { referenceSolution?: string | null }).referenceSolution ?? null)
            : null,
        };
      }),
    submissions: submissions.map((s) => {
      const g = s.grades[0];
      const released = !!g?.releasedAt && g.finalScore !== null;
      return {
        id: s.id,
        attemptNumber: s.attemptNumber,
        submittedAt: s.submittedAt,
        status: s.status,
        isLate: s.isLate,
        gradeReleased: released,
        score: released ? { points: g!.finalScore!, maxPoints: g!.maxPoints } : null,
        feedback: released ? g!.feedback : null,
      };
    }),
    progressStatus,
    progressLabel: PROGRESS_LABELS[progressStatus],
    canSubmit: submitBlockedReason === null,
    submitBlockedReason,
    preview,
  };

  if (!preview) {
    const assignmentVersion = a.currentVersion?.version;
    if (assignmentVersion) {
      const base = `${user.sessionId || user.id}:${assignmentId}:${day()}`;
      await recordEvent({
        eventName: "assignment_opened",
        actorId: user.id,
        courseId: a.courseId,
        assignmentId,
        assignmentVersion,
        idempotencyKey: `assignment_opened:${base}`,
        metadata: { mode: review ? "REVIEW" : "PROTECTED" },
      });
      const first = view.questions[0];
      if (first) await recordQuestionViewed(user, assignmentId, first.id);
    }
    await prisma.assignmentProgress.upsert({
      where: { userId_assignmentId: { userId: user.id, assignmentId } },
      create: {
        userId: user.id,
        assignmentId,
        firstOpenedAt: new Date(),
        lastActivityAt: new Date(),
      },
      update: { lastActivityAt: new Date() },
    });
  }
  return view;
}

/** Deduplicated per session/day. Safe to call whenever the student focuses a question. Never throws. */
export async function recordQuestionViewed(
  user: CurrentUser,
  assignmentId: string,
  questionId: string,
): Promise<void> {
  try {
    const a = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        courseId: true,
        currentVersion: { select: { version: true } },
        questions: {
          where: { id: questionId },
          select: { currentVersion: { select: { version: true } } },
        },
      },
    });
    const version = a?.currentVersion?.version;
    if (!a || !version || a.questions.length === 0) return;
    if (!activeMembership(user, a.courseId)) return;
    await recordEvent({
      eventName: "question_viewed",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId,
      assignmentVersion: version,
      questionId,
      questionVersion: a.questions[0]?.currentVersion?.version,
      idempotencyKey: `question_viewed:${user.sessionId || user.id}:${questionId}:${day()}`,
      metadata: {},
    });
  } catch (err) {
    console.error("[queries] recordQuestionViewed failed", err);
  }
}
