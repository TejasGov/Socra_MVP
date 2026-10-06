import Link from "next/link";
import { requirePageUser } from "@/server/auth/current-user";
import {
  getAssignmentAnalytics,
  getCourseOverview,
  type AssignmentAnalytics,
  type CourseOverview,
} from "@/server/domain/analytics";
import {
  EmptyState,
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
  TextLink,
  formatShortDate,
} from "@/components/ui";
import { AnonymousScope, DepthText, Funnel, MetricText, formatPct } from "./_components/charts";
import { analyticsErrorMessage, pickCourse } from "./_components/course";

export const metadata = { title: "Class analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; assignmentId?: string }>;
}) {
  const user = await requirePageUser("/faculty/analytics");
  const { courseId, assignmentId } = await searchParams;
  const { course } = await pickCourse(user, courseId);
  if (!course) {
    return (
      <>
        <PageHeader title="Class analytics" />
        <EmptyState>You are not on the teaching staff of any course yet.</EmptyState>
      </>
    );
  }

  let overview: CourseOverview;
  let detail: AssignmentAnalytics | null = null;
  try {
    overview = await getCourseOverview(user, course.id);
    // Default to the newest assignment with enough data to show metrics; fall back to the last one.
    const withData = [...overview.assignments]
      .reverse()
      .find((a) => !a.completion.suppressed && a.completion.denominator >= overview.threshold);
    const selected =
      assignmentId ??
      withData?.assignmentId ??
      overview.assignments[overview.assignments.length - 1]?.assignmentId;
    if (selected && overview.assignments.some((a) => a.assignmentId === selected)) {
      detail = await getAssignmentAnalytics(user, selected);
    }
  } catch (err) {
    const message = analyticsErrorMessage(err);
    if (!message) throw err;
    return (
      <>
        <PageHeader title="Class analytics" />
        <ErrorState title="Class analytics unavailable">{message}</ErrorState>
      </>
    );
  }
  const q = `courseId=${course.id}`;

  return (
    <>
      <PageHeader
        title="Class analytics"
        meta={`${overview.courseCode} · ${overview.assignments.length} published or closed assignments · minimum group size ${overview.threshold}`}
        back={{ href: `/faculty?${q}`, label: "Overview" }}
      >
        <AnonymousScope />
      </PageHeader>

      <section className="space-y-3" aria-labelledby="trend-heading">
        <h2 id="trend-heading" className="text-fg text-base font-semibold">
          Assignment trend
        </h2>
        <p className="text-fg-subtle text-xs">
          Ordered by due date. Correctness is per student-question pair with a graded attempt.
        </p>
        {overview.assignments.length === 0 ? (
          <EmptyState
            action={<TextLink href="/faculty/assignments/new">Create assignment</TextLink>}
          >
            No published assignments yet. Their metrics will appear here once students submit.
          </EmptyState>
        ) : (
          <Table caption="Assignment trend">
            <THead>
              <tr>
                <TH>Assignment</TH>
                <TH>Due</TH>
                <TH>Completion</TH>
                <TH>First attempt</TH>
                <TH>Final</TH>
                <TH>After Socra and revision</TH>
                <TH>Intervention level</TH>
              </tr>
            </THead>
            <TBody>
              {overview.assignments.map((a) => (
                <TR
                  key={a.assignmentId}
                  className={
                    a.assignmentId === detail?.assignmentId ? "bg-accent-subtle" : undefined
                  }
                >
                  <TD>
                    <Link
                      href={`/faculty/analytics?${q}&assignmentId=${a.assignmentId}`}
                      className="hover:underline"
                      aria-current={a.assignmentId === detail?.assignmentId ? "true" : undefined}
                    >
                      {a.title}
                    </Link>
                  </TD>
                  <TD className="text-fg-muted tabular-nums">
                    {a.dueAt ? formatShortDate(a.dueAt) : "No due date"}
                  </TD>
                  <TD>
                    <MetricText metric={a.completion} />
                  </TD>
                  <TD>
                    <MetricText metric={a.firstAttemptCorrectness} />
                  </TD>
                  <TD>
                    <MetricText metric={a.finalCorrectness} />
                  </TD>
                  <TD>
                    <MetricText metric={a.guidedRecovery} />
                  </TD>
                  <TD>
                    <DepthText metric={a.interventionDepth} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {detail ? (
        <section className="mt-8 space-y-4" aria-labelledby="detail-heading">
          <h2 id="detail-heading" className="text-fg text-base font-semibold">
            {detail.title}
          </h2>
          <MetricStrip>
            <Metric
              label="Completion"
              metric={detail.completion}
              unit="enrolled"
              minN={detail.threshold}
            />
            <Metric
              label="Correct on first attempt"
              metric={detail.firstAttemptCorrectness}
              unit="student-questions"
              minN={detail.threshold}
            />
            <Metric
              label="Correct on final attempt"
              metric={detail.finalCorrectness}
              unit="student-questions"
              minN={detail.threshold}
            />
            <Metric
              label="Correct after Socra and revision"
              metric={detail.guidedRecovery}
              unit="who revised"
              minN={detail.threshold}
            />
            <Metric
              label="Improved on a later attempt"
              metric={detail.retryImprovement}
              unit="who retried"
              minN={detail.threshold}
            />
          </MetricStrip>

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div className="space-y-2">
              <h3 className="text-fg text-sm font-semibold">Questions</h3>
              <Table caption={`Questions in ${detail.title}`}>
                <THead>
                  <tr>
                    <TH>Question</TH>
                    <TH>First attempt</TH>
                    <TH>Final</TH>
                    <TH>Intervention level</TH>
                  </tr>
                </THead>
                <TBody>
                  {detail.questions.map((qq, i) => (
                    <TR key={qq.questionId}>
                      <TD>
                        <Link
                          href={`/faculty/insights/questions/${qq.questionId}`}
                          data-testid="question-drilldown-link"
                          className="hover:underline"
                        >
                          Q{i + 1}. {qq.title}
                        </Link>
                      </TD>
                      <TD>
                        <MetricText metric={qq.firstAttemptCorrectness} />
                      </TD>
                      <TD>
                        <MetricText metric={qq.finalCorrectness} />
                      </TD>
                      <TD>
                        <DepthText metric={qq.interventionDepth} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Panel
              title="Socra interaction funnel"
              titleAs="h3"
              meta="Distinct students, from recorded events"
            >
              <Funnel steps={detail.funnel} />
            </Panel>
          </div>
        </section>
      ) : null}

      <section className="mt-8 space-y-3" aria-labelledby="topics-heading">
        <h2 id="topics-heading" className="text-fg text-base font-semibold">
          Topics
        </h2>
        <p className="text-fg-subtle text-xs">
          Showing difficulty: students whose graded and practice outcomes on the topic were mostly
          incorrect or needed deep hints. Needs reinforcement: current learner-model state.
        </p>
        <Table caption="Topic metrics">
          <THead>
            <tr>
              <TH>Topic</TH>
              <TH>Showing difficulty</TH>
              <TH>Needs reinforcement now</TH>
              <TH>First attempt</TH>
              <TH>Final</TH>
            </tr>
          </THead>
          <TBody>
            {overview.topics.length === 0 ? (
              <TR>
                <TD colSpan={5} className="text-fg-muted">
                  No topics have graded or practice work yet.
                </TD>
              </TR>
            ) : null}
            {[...overview.topics].map((t) => (
              <TR key={t.topicId}>
                <TD>
                  <Link href={`/faculty/insights/topics/${t.topicId}`} className="hover:underline">
                    {t.name}
                  </Link>
                </TD>
                <TD>
                  <MetricText metric={t.difficulty} />
                </TD>
                <TD>
                  <MetricText metric={t.unresolved} />
                </TD>
                <TD>
                  <MetricText metric={t.firstAttemptCorrectness} />
                </TD>
                <TD>
                  <MetricText metric={t.finalCorrectness} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {overview.topics.length > 0 ? (
          <p className="text-fg-subtle text-xs">
            Highest difficulty: {overview.topics[0]!.name} (
            {formatPct(overview.topics[0]!.difficulty) || "insufficient data"}).
          </p>
        ) : null}
      </section>
    </>
  );
}
