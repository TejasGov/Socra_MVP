import Link from "next/link";
import { requirePageUser } from "@/server/auth/current-user";
import { getTopicDrilldown, type TopicDrilldown } from "@/server/domain/analytics";
import {
  ErrorState,
  Metric,
  MetricStrip,
  PageHeader,
  Panel,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import {
  AnonymousScope,
  BarList,
  DepthText,
  MetricText,
} from "../../../analytics/_components/charts";
import { analyticsErrorMessage } from "../../../analytics/_components/course";

export const metadata = { title: "Topic insight" };
export const dynamic = "force-dynamic";

export default async function TopicInsightPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  const user = await requirePageUser(`/faculty/insights/topics/${topicId}`);
  let d: TopicDrilldown;
  try {
    d = await getTopicDrilldown(user, topicId);
  } catch (err) {
    const message = analyticsErrorMessage(err);
    if (!message) throw err;
    return (
      <>
        <PageHeader title="Topic insight" back={{ href: "/faculty", label: "Overview" }} />
        <ErrorState title="Topic insight unavailable">{message}</ErrorState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Topic: ${d.name}`}
        meta={d.description ?? undefined}
        back={{ href: `/faculty?courseId=${d.courseId}`, label: "Overview" }}
      >
        <AnonymousScope />
      </PageHeader>

      <MetricStrip className="mb-6">
        <Metric
          label="Needs reinforcement"
          metric={d.stateDistribution.needsReinforcement}
          unit="students with a state"
          minN={d.threshold}
        />
        <Metric
          label="Developing"
          metric={d.stateDistribution.developing}
          unit="students with a state"
          minN={d.threshold}
        />
        <Metric
          label="Consistently demonstrated"
          metric={d.stateDistribution.consistentlyDemonstrated}
          unit="students with a state"
          minN={d.threshold}
        />
        <Metric
          label="Correct on first attempt"
          metric={d.firstAttemptCorrectness}
          unit="student-questions"
          minN={d.threshold}
        />
        <Metric
          label="Correct on final attempt"
          metric={d.finalCorrectness}
          unit="student-questions"
          minN={d.threshold}
        />
      </MetricStrip>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-2">
          <h2 className="text-fg text-base font-semibold">Questions on this topic</h2>
          {d.questions.length === 0 ? (
            <p className="text-fg-muted text-sm">
              No published question is tagged with this topic.
            </p>
          ) : (
            <Table caption={`Questions tagged ${d.name}`}>
              <THead>
                <tr>
                  <TH>Question</TH>
                  <TH>First attempt</TH>
                  <TH>Final</TH>
                  <TH>Intervention level</TH>
                </tr>
              </THead>
              <TBody>
                {d.questions.map((q) => (
                  <TR key={q.questionId}>
                    <TD>
                      <Link
                        href={`/faculty/insights/questions/${q.questionId}`}
                        data-testid="question-drilldown-link"
                        className="hover:underline"
                      >
                        {q.title}
                      </Link>
                      <span className="text-fg-subtle block text-xs">{q.assignmentTitle}</span>
                    </TD>
                    <TD>
                      <MetricText metric={q.firstAttemptCorrectness} />
                    </TD>
                    <TD>
                      <MetricText metric={q.finalCorrectness} />
                    </TD>
                    <TD>
                      <DepthText metric={q.interventionDepth} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        <div className="space-y-6">
          <Panel
            title="Misconceptions"
            meta="Reviewed labels, share of students with work on this topic"
          >
            {d.misconceptions.length === 0 ? (
              <p className="text-fg-muted text-sm">
                No reviewed misconceptions recorded for this topic.
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
          </Panel>
          <Panel title="Related topics">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-fg-muted">Builds on</dt>
                <dd>
                  {d.prerequisites.length === 0 ? (
                    <span className="text-fg-subtle">No prerequisites recorded</span>
                  ) : (
                    d.prerequisites.map((t, i) => (
                      <span key={t.topicId}>
                        {i > 0 ? ", " : ""}
                        <Link
                          href={`/faculty/insights/topics/${t.topicId}`}
                          className="hover:underline"
                        >
                          {t.name}
                        </Link>
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Needed for</dt>
                <dd>
                  {d.dependents.length === 0 ? (
                    <span className="text-fg-subtle">No dependent topics recorded</span>
                  ) : (
                    d.dependents.map((t, i) => (
                      <span key={t.topicId}>
                        {i > 0 ? ", " : ""}
                        <Link
                          href={`/faculty/insights/topics/${t.topicId}`}
                          className="hover:underline"
                        >
                          {t.name}
                        </Link>
                      </span>
                    ))
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Intervention level on this topic</dt>
                <dd>
                  <DepthText metric={d.interventionDepth} />
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
