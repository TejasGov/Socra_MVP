import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { requirePageUser } from "@/server/auth/current-user";
import { getQuestionDrilldown, type QuestionDrilldown } from "@/server/domain/analytics";
import { ErrorState, Metric, MetricStrip, PageHeader, Panel } from "@/components/ui";
import {
  AnonymousScope,
  BarList,
  Funnel,
  MetricText,
  formatPct,
} from "../../../analytics/_components/charts";
import { analyticsErrorMessage } from "../../../analytics/_components/course";

export const metadata = { title: "Question insight" };
export const dynamic = "force-dynamic";

export default async function QuestionInsightPage({
  params,
}: {
  params: Promise<{ questionId: string }>;
}) {
  const { questionId } = await params;
  const user = await requirePageUser(`/faculty/insights/questions/${questionId}`);
  let d: QuestionDrilldown;
  try {
    d = await getQuestionDrilldown(user, questionId);
  } catch (err) {
    const message = analyticsErrorMessage(err);
    if (!message) throw err;
    return (
      <>
        <PageHeader
          title="Question insight"
          back={{ href: "/faculty/insights", label: "Question insights" }}
        />
        <ErrorState title="Question insight unavailable">{message}</ErrorState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Question insight: ${d.title}`}
        meta={
          <>
            <Link
              href={`/faculty/analytics?courseId=${d.courseId}&assignmentId=${d.assignmentId}`}
              className="hover:underline"
            >
              {d.assignmentTitle}
            </Link>
            {d.topics.length > 0 ? <> · {d.topics.map((t) => t.name).join(", ")}</> : null}
          </>
        }
        back={{
          href: `/faculty/analytics?courseId=${d.courseId}&assignmentId=${d.assignmentId}`,
          label: "Assignment analytics",
        }}
      >
        <AnonymousScope />
      </PageHeader>

      <MetricStrip className="mb-6">
        <Metric
          label="Correct on first attempt"
          metric={d.firstAttemptCorrectness}
          unit="students"
          minN={d.threshold}
        />
        <Metric
          label="Correct on final attempt"
          metric={d.finalCorrectness}
          unit="students"
          minN={d.threshold}
        />
        <Metric
          label="Correct after Socra and revision"
          metric={d.guidedRecovery}
          unit="who revised"
          minN={d.threshold}
        />
        <Metric
          label="Avg. intervention level"
          metric={d.interventionDepth}
          format="decimal"
          unit="students who used Socra"
          context={d.interventionDepth.max !== null ? `max L${d.interventionDepth.max}` : undefined}
          minN={d.threshold}
        />
        <Metric label="Submitted" metric={d.completion} unit="enrolled" minN={d.threshold} />
      </MetricStrip>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Question" titleAs="h2">
          <div className="prose-sm text-fg [&_pre]:bg-surface-2 max-w-[68ch] text-sm [&_code]:font-mono [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3">
            <ReactMarkdown>{d.prompt || "No prompt text recorded."}</ReactMarkdown>
          </div>
          {d.topics.length > 0 ? (
            <p className="text-fg-subtle mt-3 text-xs">
              Topics:{" "}
              {d.topics.map((t, i) => (
                <span key={t.topicId}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/faculty/insights/topics/${t.topicId}`} className="hover:underline">
                    {t.name}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </Panel>

        <Panel title="Class outcome" titleAs="h2">
          <dl className="space-y-3 text-sm">
            <Row label="Correct on first attempt">
              <MetricText metric={d.firstAttemptCorrectness} />
            </Row>
            <Row label="Correct after Socra guidance and revision">
              <MetricText metric={d.guidedRecovery} />
            </Row>
            <Row label="Correct on final attempt">
              <MetricText metric={d.finalCorrectness} />
            </Row>
            <Row label="Improved on a later attempt">
              <MetricText metric={d.retryImprovement} unit="who retried" />
            </Row>
            <Row label="Students who submitted">
              <span className="tabular-nums" data-testid="analytics-metric">
                {d.completionCount}
              </span>
            </Row>
            <Row label="Students with more than one attempt">
              <span className="tabular-nums" data-testid="analytics-metric">
                {d.retryCount}
              </span>
            </Row>
          </dl>
          <p className="text-fg-subtle mt-3 text-xs">{outcomeSentence(d)}</p>
        </Panel>

        <Panel
          title="Socra interaction funnel"
          titleAs="h2"
          meta="Distinct students, computed from recorded events"
        >
          <Funnel steps={d.funnel} />
        </Panel>

        <Panel
          title="Common misconceptions"
          titleAs="h2"
          meta="Reviewed labels only. Share of students who submitted this question."
        >
          {d.misconceptions.length === 0 ? (
            <p className="text-fg-muted text-sm">
              No reviewed misconceptions have been recorded on this question.
            </p>
          ) : (
            <BarList
              rows={d.misconceptions.map((m) => ({
                key: m.misconceptionId,
                label: m.label,
                metric: m.prevalence,
              }))}
              unit="students"
              suppressedNoun="misconception"
              highlightFirst={false}
            />
          )}
          <p className="text-fg-subtle mt-3 text-xs">
            Labels come from automated detectors and faculty tags; an observation is not a confirmed
            diagnosis. No student identities or conversation text are shown.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function outcomeSentence(d: QuestionDrilldown): string {
  const a = d.firstAttemptCorrectness;
  const b = d.guidedRecovery;
  if (a.value === null || b.value === null) {
    return "Not enough students yet to compare first attempts with attempts after guidance.";
  }
  const diff = Math.round((b.value - a.value) * 100);
  return `Correctness was ${formatPct(a)} on first attempts and ${formatPct(b)} on attempts after Socra guidance and revision, a difference of ${Math.abs(diff)} percentage points. This is an observed difference, not a measured effect of Socra.`;
}
