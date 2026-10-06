import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  DateText,
  EmptyState,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { AuthError } from "@/server/auth/rbac";
import { syncAssignmentState } from "@/server/domain/assignments/service";
import { listSubmissionsForAssignment } from "@/server/domain/grading/service";
import { PROGRESS_LABELS, type ProgressStatus } from "@/server/domain/assignments/state-machine";
import { HttpError } from "@/server/http";

export const metadata = { title: "Submissions" };
export const dynamic = "force-dynamic";

const GRADE: Record<string, { label: string; tone: BadgeTone }> = {
  NONE: { label: "No submission", tone: "neutral" },
  PENDING_RUNNER: { label: "Waiting for code runner", tone: "warning" },
  PENDING: { label: "Grading", tone: "neutral" },
  SUGGESTED: { label: "Needs your review", tone: "accent" },
  FINAL: { label: "Graded", tone: "success" },
};

// Staff wording: students see "Feedback available"; faculty see "Returned".
const STAFF_PROGRESS: Record<ProgressStatus, string> = {
  ...PROGRESS_LABELS,
  RETURNED: "Returned",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/faculty/assignments/${id}/submissions`);
  let data;
  try {
    await syncAssignmentState(id);
    data = await listSubmissionsForAssignment(user, id);
  } catch (e) {
    if (e instanceof HttpError || e instanceof AuthError) notFound();
    throw e;
  }
  const { assignment, rows } = data;
  const submitted = rows.filter((r) => r.submissionId).length;
  const toReview = rows.filter((r) => r.gradeStatus === "SUGGESTED").length;
  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title={`Submissions: ${assignment.title}`}
        meta={`${submitted} of ${rows.length} students have submitted${toReview ? ` · ${toReview} need your review` : ""} · ${assignment.totalPoints} points`}
        back={{ href: `/faculty/assignments/${id}/edit`, label: "Assignment" }}
      />
      {rows.length === 0 ? (
        <EmptyState>No students are enrolled in this course yet.</EmptyState>
      ) : (
        <Table caption="Student submissions">
          <THead>
            <TR>
              <TH>Student</TH>
              <TH>Status</TH>
              <TH numeric>Attempts</TH>
              <TH>Latest submission</TH>
              <TH numeric>Score</TH>
              <TH>Grading</TH>
              <TH>
                <span className="sr-only">Open</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const g = GRADE[r.gradeStatus] ?? GRADE.NONE!;
              return (
                <TR key={r.userId}>
                  <TD>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-fg-subtle text-xs">{r.email}</p>
                  </TD>
                  <TD>{STAFF_PROGRESS[r.progress as ProgressStatus] ?? r.progress}</TD>
                  <TD numeric>{r.attemptsUsed}</TD>
                  <TD>
                    {r.submittedAt ? (
                      <>
                        <DateText date={r.submittedAt} />
                        {r.isLate ? (
                          <Badge tone="warning" className="ml-2">
                            Late
                          </Badge>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-fg-subtle">Not submitted</span>
                    )}
                  </TD>
                  <TD numeric>
                    {r.score !== null && r.maxScore !== null ? (
                      `${r.score} / ${r.maxScore}`
                    ) : (
                      <span className="text-fg-subtle">-</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={g.tone}>{g.label}</Badge>
                    {r.gradeStatus === "FINAL" && !r.released ? (
                      <p className="text-fg-subtle mt-0.5 text-xs">Not returned yet</p>
                    ) : null}
                  </TD>
                  <TD>
                    {r.submissionId ? (
                      <Link
                        className="text-accent hover:underline"
                        href={`/faculty/grading/${r.submissionId}`}
                      >
                        Open grading
                      </Link>
                    ) : null}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      <p className="text-fg-subtle mt-3 text-xs">
        Scores for ungraded work are test results awaiting your review. Student Socra conversations
        are not shown anywhere on this page.
      </p>
    </div>
  );
}
