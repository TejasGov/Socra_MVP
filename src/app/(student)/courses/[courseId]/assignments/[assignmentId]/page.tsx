import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AssignmentWorkspace } from "@/components/workspace/assignment-workspace";
import type {
  PublicTestDto,
  StudentRunDto,
  WorkspaceDto,
  WorkspaceQuestionDto,
} from "@/components/workspace/types";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import {
  getAssignmentForStudent,
  type PublicTestView,
  type StudentAssignmentView,
  type StudentRunSummary,
} from "@/server/domain/assignments/queries";
import { isEnabled } from "@/server/flags";

export const dynamic = "force-dynamic";

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function toPublicTest(t: PublicTestView): PublicTestDto {
  if (t.kind === "stdio") {
    return {
      id: t.id,
      name: t.name,
      input: t.stdin ? `stdin: ${t.stdin.replace(/\n/g, "\\n")}` : "(no input)",
      expected: (t.expectedStdout ?? "").replace(/\n/g, "\\n"),
    };
  }
  const args = (t.args ?? []).map(show).join(", ");
  return {
    id: t.id,
    name: t.name,
    input: `${t.entryPoint ?? "f"}(${args})`,
    expected: t.expectedReturn === undefined ? "" : show(t.expectedReturn),
  };
}

function toRun(run: StudentRunSummary | null): StudentRunDto | null {
  if (!run || run.kind === "GRADING") return null;
  return {
    runId: run.runId,
    kind: run.kind,
    status: run.status as StudentRunDto["status"],
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    truncated: false,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    testResults: (run.testResults as Array<Record<string, unknown>>).map((t) => ({
      testId: String(t.testId ?? t.id ?? ""),
      name: String(t.name ?? "Test"),
      passed: t.passed === true,
      actual: t.actual === undefined || t.actual === null ? undefined : String(t.actual),
      expected: t.expected === undefined || t.expected === null ? undefined : String(t.expected),
      message: typeof t.message === "string" ? t.message : undefined,
    })),
  };
}

/** Multiple-choice options are stored as [{ id, text }] or plain strings; both map to { id, label }. */
function parseChoices(raw: unknown): Array<{ id: string; label: string }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ id: string; label: string }> = [];
  raw.forEach((c, i) => {
    if (typeof c === "string") out.push({ id: c, label: c });
    else if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      const label = String(o.text ?? o.label ?? "");
      out.push({ id: String(o.id ?? i), label });
    }
  });
  return out.length ? out : null;
}

async function toDto(view: StudentAssignmentView): Promise<WorkspaceDto> {
  // The student-safe `choices` column is read directly so object-shaped options are not lost.
  const mcIds = view.questions.filter((q) => q.type === "MULTIPLE_CHOICE").map((q) => q.id);
  const choiceRows = mcIds.length
    ? await prisma.question.findMany({
        where: { id: { in: mcIds } },
        select: { id: true, currentVersion: { select: { choices: true } } },
      })
    : [];
  const socraAvailable = await isEnabled("protectedSocra", { courseId: view.courseId }).catch(
    () => true,
  );
  const latest = view.submissions[0] ?? null;

  const questions: WorkspaceQuestionDto[] = view.questions.map((q) => ({
    id: q.id,
    title: q.title,
    prompt: q.prompt,
    type: q.type,
    language: q.language,
    starterCode: q.starterCode ?? "",
    points: q.points,
    choices:
      q.type === "MULTIPLE_CHOICE"
        ? (parseChoices(choiceRows.find((r) => r.id === q.id)?.currentVersion?.choices) ??
          parseChoices(q.choices))
        : null,
    publicTests: q.publicTests.map(toPublicTest),
    draft: q.draft
      ? {
          content: q.draft.content,
          version: q.draft.version,
          updatedAt: q.draft.updatedAt.toISOString(),
        }
      : null,
    latestRun: toRun(q.latestRun),
    answerReview: q.answerReview,
  }));

  return {
    assignmentId: view.id,
    courseId: view.courseId,
    courseCode: view.courseCode,
    title: view.title,
    description: view.description,
    format: view.format,
    state: view.state,
    progressStatus: view.progressStatus,
    mode: view.mode,
    solutionsReleased: view.solutionsReleased,
    dueAt: view.dueAt ? view.dueAt.toISOString() : null,
    overdue: !!view.dueAt && view.dueAt.getTime() < Date.now() && view.state !== "CLOSED",
    closeAt: view.closeAt ? view.closeAt.toISOString() : null,
    attemptLimit: view.attemptLimit,
    attemptsUsed: view.attemptsUsed,
    allowResubmission: view.allowResubmission,
    canSubmit: view.canSubmit,
    submitBlockedReason: view.submitBlockedReason,
    latestSubmission: latest
      ? {
          submissionId: latest.id,
          attemptNumber: latest.attemptNumber,
          submittedAt: latest.submittedAt.toISOString(),
          status: latest.status,
        }
      : null,
    learningObjectives: view.learningObjectives,
    topics: view.topics.map((t) => t.name),
    questions,
    socraAvailable,
  };
}

// Static title: reading the assignment here would bypass the access checks in getAssignmentForStudent
// (and re-record assignment_opened). The visible h1 carries the real title.
export const metadata = { title: "Assignment" };

export default async function AssignmentWorkspacePage({
  params,
}: {
  params: Promise<{ courseId: string; assignmentId: string }>;
}) {
  const { courseId, assignmentId } = await params;
  const user = await requirePageUser(`/courses/${courseId}/assignments/${assignmentId}`);
  const view = await getAssignmentForStudent(user, assignmentId);
  if (!view || view.courseId !== courseId) notFound();
  const data = await toDto(view);

  const meta = [
    view.courseCode,
    view.format === "CODING" ? "Coding" : view.format === "WRITTEN" ? "Written" : "Quiz",
    view.totalPoints > 0 ? `${view.totalPoints} points` : null,
    view.topics.length ? view.topics.map((t) => t.name).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-shell-width="full" className="mx-auto max-w-[1440px]">
      <PageHeader
        title={view.title}
        meta={meta}
        back={{ href: `/courses/${courseId}`, label: `${view.courseCode} assignments` }}
      >
        {view.preview ? (
          <p className="text-fg-muted text-sm">
            Staff preview. Nothing you do here is stored as student work, and submission is
            disabled.
          </p>
        ) : null}
        {view.learningObjectives.length ? (
          <details className="text-sm">
            <summary className="text-fg-muted hover:text-fg cursor-pointer">
              Learning objectives ({view.learningObjectives.length})
            </summary>
            <ul className="text-fg mt-1 max-w-[68ch] list-disc pl-5">
              {view.learningObjectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </PageHeader>
      <AssignmentWorkspace data={data} />
    </div>
  );
}
