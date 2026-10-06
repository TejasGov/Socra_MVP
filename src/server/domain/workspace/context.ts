import "server-only";
import { prisma } from "@/server/db";
import { HttpError } from "@/server/http";
import type {
  AssignmentContext,
  InterventionLevel,
  LatestExecutionContext,
  PolicyContext,
  WorkspaceContext,
} from "@/server/ai/types";
import { syncAssignmentState } from "@/server/domain/assignments/service";
import { studentMode } from "@/server/domain/assignments/state-machine";
import {
  DEFAULT_ALLOWED_BEHAVIORS,
  DEFAULT_FORBIDDEN_BEHAVIORS,
  DEFAULT_HINT_LADDER,
} from "@/server/domain/assignments/schema";

export interface WorkspaceContextForAi {
  assignment: AssignmentContext;
  workspace: WorkspaceContext;
  latestExecution: LatestExecutionContext | null;
  policy: PolicyContext;
  mode: "PROTECTED_ASSESSMENT" | "POST_ASSESSMENT_REVIEW";
}

const lvl = (n: number): InterventionLevel =>
  Math.max(0, Math.min(6, Math.trunc(n))) as InterventionLevel;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Effective Socra mode for a student on an assignment. Per-student progress is ignored on purpose:
 * submitting does not unlock review mode; only CLOSED + solutions released does.
 */
export async function getEffectiveAiMode(
  _userId: string,
  assignmentId: string,
): Promise<"PROTECTED_ASSESSMENT" | "POST_ASSESSMENT_REVIEW"> {
  await syncAssignmentState(assignmentId);
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { state: true, solutionsReleased: true },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  return studentMode(a);
}

/**
 * Context the AI gateway attaches automatically. PUBLIC test output only. The reference solution is included only in
 * POST_ASSESSMENT_REVIEW (closed and released). Hidden and diagnostic test contents are never selected.
 */
export async function getWorkspaceContextForAi(
  userId: string,
  assignmentId: string,
  questionId?: string,
): Promise<WorkspaceContextForAi> {
  const mode = await getEffectiveAiMode(userId, assignmentId);
  const review = mode === "POST_ASSESSMENT_REVIEW";
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      courseId: true,
      title: true,
      description: true,
      format: true,
      language: true,
      currentVersion: { select: { version: true, policyVersionId: true } },
      socraPolicy: { select: { currentVersionId: true } },
      objectives: { select: { objective: { select: { description: true } } } },
      topics: { select: { topic: { select: { name: true } } } },
      questions: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          currentVersion: {
            select: {
              version: true,
              title: true,
              prompt: true,
              language: true,
              starterCode: true,
              referenceSolution: review,
            },
          },
        },
      },
    },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  const member = await prisma.courseMembership.findUnique({
    where: { userId_courseId: { userId, courseId: a.courseId } },
    select: { status: true },
  });
  if (member?.status !== "ACTIVE")
    throw new HttpError(403, "not_course_member", "Not a member of this course");

  const q = (questionId ? a.questions.find((x) => x.id === questionId) : a.questions[0]) ?? null;
  if (!q?.currentVersion) throw new HttpError(404, "question_not_found", "Question not found");
  const v = q.currentVersion;

  const [draft, run, policyRow] = await Promise.all([
    prisma.draft.findUnique({
      where: { userId_questionId: { userId, questionId: q.id } },
      select: { content: true, version: true, language: true },
    }),
    prisma.codeRun.findFirst({
      where: { userId, questionId: q.id, completedAt: { not: null } },
      orderBy: { queuedAt: "desc" },
      select: {
        id: true,
        status: true,
        stdout: true,
        stderr: true,
        exitCode: true,
        testResults: true,
        completedAt: true,
      },
    }),
    prisma.socraPolicyVersion.findFirst({
      where: a.currentVersion?.policyVersionId
        ? { id: a.currentVersion.policyVersionId }
        : a.socraPolicy?.currentVersionId
          ? { id: a.socraPolicy.currentVersionId }
          : { id: "none" },
    }),
  ]);

  const language = draft?.language ?? v.language ?? a.language ?? null;
  const assignment: AssignmentContext = {
    assignmentId: a.id,
    assignmentVersion: a.currentVersion?.version ?? 1,
    title: a.title,
    prompt: a.description.trim() ? `${a.description.trim()}\n\n${v.prompt}` : v.prompt,
    questionId: q.id,
    questionVersion: v.version,
    learningObjectives: a.objectives.map((o) => o.objective.description),
    topicTags: a.topics.map((t) => t.topic.name),
    format: a.format,
    starterCode: v.starterCode ?? undefined,
    ...(review
      ? {
          referenceSolution:
            (v as { referenceSolution?: string | null }).referenceSolution ?? undefined,
        }
      : {}),
  };

  const workspace: WorkspaceContext = {
    language,
    code: draft?.content ?? v.starterCode ?? "",
    draftVersion: draft?.version,
    questionTitle: v.title,
  };

  let latestExecution: LatestExecutionContext | null = null;
  if (run) {
    const tests = (Array.isArray(run.testResults) ? run.testResults : []) as Array<{
      name?: string;
      passed?: boolean;
      message?: string;
      visibility?: string;
    }>;
    latestExecution = {
      runId: run.id,
      status: run.status as LatestExecutionContext["status"],
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      exitCode: run.exitCode,
      publicTests: tests
        .filter((t) => t.visibility === "PUBLIC" || t.visibility === undefined)
        .map((t) => ({ name: String(t.name ?? ""), passed: !!t.passed, message: t.message })),
      completedAt: run.completedAt?.toISOString(),
    };
  }

  const ladder = Array.isArray(policyRow?.hintLadder)
    ? (policyRow!.hintLadder as Array<{ level: number; guidance: string }>)
    : DEFAULT_HINT_LADDER;
  const policy: PolicyContext = {
    policyId: policyRow?.policyId ?? "default",
    policyVersion: policyRow?.version ?? 0,
    maxInterventionLevel: lvl(policyRow?.maxInterventionLevel ?? 5),
    allowDirectSyntaxHelp: policyRow?.allowDirectSyntaxHelp ?? true,
    hintLadder: ladder.map((h) => ({ level: lvl(h.level), guidance: h.guidance })),
    allowedBehaviors: policyRow ? strings(policyRow.allowedBehaviors) : DEFAULT_ALLOWED_BEHAVIORS,
    forbiddenBehaviors: policyRow
      ? strings(policyRow.forbiddenBehaviors)
      : DEFAULT_FORBIDDEN_BEHAVIORS,
  };

  return { assignment, workspace, latestExecution, policy, mode };
}
