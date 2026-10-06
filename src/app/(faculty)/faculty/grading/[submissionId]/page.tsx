import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, DateText, PageHeader, Panel } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { AuthError } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { getSubmissionForGrading } from "@/server/domain/grading/service";
import { HttpError } from "@/server/http";
import { GradingForm } from "../_components/grading-form";

export const metadata = { title: "Grade submission" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const user = await requirePageUser(`/faculty/grading/${submissionId}`);
  let view;
  try {
    view = await getSubmissionForGrading(user, submissionId);
  } catch (e) {
    if (e instanceof HttpError || e instanceof AuthError) notFound();
    throw e;
  }
  const overallFeedback =
    (
      await prisma.grade.findUnique({
        where: { submissionId_scopeKey: { submissionId, scopeKey: "overall" } },
        select: { feedback: true },
      })
    )?.feedback ?? "";
  const final = view.overall?.status === "FINAL" && !!view.overall.releasedAt;
  return (
    <div className="max-w-[1000px] space-y-4">
      <PageHeader
        title={`${view.student.name}, attempt ${view.attemptNumber}`}
        meta={`${view.assignment.title} · ${view.assignment.totalPoints} points`}
        back={{
          href: `/faculty/assignments/${view.assignment.id}/submissions`,
          label: "Submissions",
        }}
      >
        <div className="text-fg-muted flex flex-wrap items-center gap-3 text-sm">
          <span>
            Submitted <DateText date={view.submittedAt} />
          </span>
          {view.isLate ? <Badge tone="warning">Late</Badge> : null}
          {final ? (
            <Badge tone="success">
              Returned: {view.overall!.finalScore} / {view.overall!.maxPoints}
            </Badge>
          ) : null}
          {view.attempts.length > 1 ? (
            <span className="flex items-center gap-2">
              Attempts:
              {view.attempts.map((a) =>
                a.id === view.submissionId ? (
                  <strong key={a.id} className="text-fg">
                    {a.attemptNumber}
                  </strong>
                ) : (
                  <Link
                    key={a.id}
                    className="text-accent hover:underline"
                    href={`/faculty/grading/${a.id}`}
                  >
                    {a.attemptNumber}
                  </Link>
                ),
              )}
            </span>
          ) : null}
        </div>
      </PageHeader>

      <GradingForm
        submissionId={view.submissionId}
        questions={view.questions}
        alreadyFinal={final}
        canFinalize={view.canFinalize}
        overallFeedback={overallFeedback}
      />

      {view.overrides.length > 0 ? (
        <Panel title="Override history" titleAs="h2">
          <ul className="divide-border divide-y text-sm">
            {view.overrides.map((o) => (
              <li key={o.id} className="py-2">
                {o.actor} changed {o.previousScore ?? "no score"} to {o.newScore}.{" "}
                <span className="text-fg-muted">{o.reason}</span>{" "}
                <DateText date={o.createdAt} className="text-fg-subtle text-xs" />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <p className="text-fg-subtle text-xs">
        Hidden test results are visible to faculty only. Student Socra conversations are not
        available on this page.
      </p>
    </div>
  );
}
