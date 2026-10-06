import Link from "next/link";
import { requirePageUser } from "@/server/auth/current-user";
import { getCourseOverview, type CourseOverview } from "@/server/domain/analytics";
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
} from "@/components/ui";
import {
  AnonymousScope,
  BarList,
  DepthText,
  MetricText,
  WeeklyBars,
  formatPct,
} from "./analytics/_components/charts";
import { BriefButton } from "./analytics/_components/brief-button";
import { analyticsErrorMessage, pickCourse } from "./analytics/_components/course";
import { fullTimestamp } from "@/components/ui";

export const metadata = { title: "Faculty overview" };
export const dynamic = "force-dynamic";

export default async function FacultyOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const user = await requirePageUser("/faculty");
  const { courseId } = await searchParams;
  const { course } = await pickCourse(user, courseId);
  if (!course) {
    return (
      <>
        <PageHeader title="Faculty overview" />
        <EmptyState>
          You are not on the teaching staff of any course yet. Ask an administrator to add you to a
          course roster.
        </EmptyState>
      </>
    );
  }

  let overview: CourseOverview;
  try {
    overview = await getCourseOverview(user, course.id);
  } catch (err) {
    const message = analyticsErrorMessage(err);
    if (!message) throw err;
    return (
      <>
        <PageHeader title={`${course.code} overview`} />
        <ErrorState title="Class analytics unavailable">{message}</ErrorState>
      </>
    );
  }
  const q = `?courseId=${course.id}`;
  const o = overview;
  const unresolvedCount = o.unresolvedConcepts.length;

  return (
    <>
      <PageHeader
        title={`${o.courseCode} faculty insights`}
        meta={
          <>
            {o.courseTitle} · {o.activeStudents.denominator} enrolled students
            {o.computedAt ? <> · updated {fullTimestamp(o.computedAt)}</> : null}
          </>
        }
        actions={<TextLink href={`/faculty/analytics${q}`}>Assignment and topic tables</TextLink>}
      >
        <AnonymousScope />
      </PageHeader>

      <MetricStrip className="mb-6">
        <Metric
          label="Active students (last 14 days)"
          metric={o.activeStudents}
          unit="enrolled"
          minN={o.threshold}
        />
        <Metric
          label="Assignment completion"
          metric={o.completion}
          unit="student-assignments"
          minN={o.threshold}
        />
        <Metric
          label="Correct on first attempt"
          metric={o.firstAttemptCorrectness}
          unit="student-questions"
          minN={o.threshold}
        />
        <Metric
          label="Correct after Socra and revision"
          metric={o.guidedRecovery}
          unit="who revised"
          minN={o.threshold}
        />
        <Metric
          label="Improved on a later attempt"
          metric={o.retryImprovement}
          unit="who retried"
          minN={o.threshold}
        />
        <Metric
          label="Avg. intervention level per task"
          metric={o.interventionDepth}
          format="decimal"
          unit="tasks with Socra"
          context={o.interventionDepth.max !== null ? `max L${o.interventionDepth.max}` : undefined}
          minN={o.threshold}
        />
        <Metric
          label="Students who used Socra"
          metric={o.socraUsage}
          unit="enrolled"
          minN={o.threshold}
        />
      </MetricStrip>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Socra usage by week"
          meta="Share of active students who started a Socra session"
        >
          {o.weeklyUsage.length > 0 ? (
            <WeeklyBars
              title="Socra usage by week"
              weeks={o.weeklyUsage.map((w) => ({
                week: w.week,
                weekStart: w.weekStart,
                metric: w.socraUsers,
                sessions: w.sessions,
              }))}
            />
          ) : (
            <p className="text-fg-muted text-sm">No weekly activity has been recorded yet.</p>
          )}
        </Panel>

        <Panel
          title="Top class pain points"
          meta="Students currently showing difficulty, out of students with graded or practice work on the topic."
        >
          <BarList
            rows={o.painPoints.map((t) => ({
              key: t.topicId,
              label: t.name,
              href: `/faculty/insights/topics/${t.topicId}`,
              metric: t.difficulty,
            }))}
            unit="students"
            suppressedNoun="topic"
          />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="First attempt and after guidance"
          meta="Pooled over all graded student-question pairs"
        >
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Correct on first attempt</dt>
              <dd>
                <MetricText metric={o.firstAttemptCorrectness} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Correct after using Socra and revising</dt>
              <dd>
                <MetricText metric={o.guidedRecovery} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Correct on final attempt</dt>
              <dd>
                <MetricText metric={o.finalCorrectness} />
              </dd>
            </div>
          </dl>
          <p className="text-fg-subtle mt-3 text-xs">
            {comparisonSentence(o)} These are observed differences between groups and attempts, not
            evidence that Socra caused them.
          </p>
        </Panel>

        <Panel
          title="Unresolved concepts"
          meta="Topics where at least 25% of students are currently in Needs reinforcement."
        >
          {unresolvedCount === 0 ? (
            <p className="text-fg-muted text-sm">
              No topic currently meets the unresolved threshold with enough students.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {o.unresolvedConcepts.map((t) => (
                <li key={t.topicId} className="flex justify-between gap-3">
                  <Link
                    href={`/faculty/insights/topics/${t.topicId}`}
                    className="text-fg hover:underline"
                  >
                    {t.name}
                  </Link>
                  <MetricText metric={t.unresolved} unit="students" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Misconception patterns"
          meta="Students with at least one reviewed label this term (any assignment, confidence 0.6 or higher). Many later corrected it, so these counts are larger than the current-difficulty counts."
        >
          <BarList
            rows={o.misconceptions.slice(0, 6).map((m) => ({
              key: m.misconceptionId,
              label: m.label,
              href: `/faculty/insights/topics/${m.topicId}`,
              metric: m.prevalence,
            }))}
            unit="students"
            suppressedNoun="misconception"
            highlightFirst={false}
          />
        </Panel>

        <Panel title="Recommendation" meta="Advisory. Based on the computed metrics on this page.">
          {o.recommendation ? (
            <div className="space-y-2 text-sm">
              <p className="text-fg">{o.recommendation.text}</p>
              <p className="text-fg-subtle text-xs">Basis: {o.recommendation.basis}</p>
              {o.recommendation.topicId ? (
                <TextLink href={`/faculty/insights/topics/${o.recommendation.topicId}`}>
                  Open topic details
                </TextLink>
              ) : null}
            </div>
          ) : (
            <p className="text-fg-muted text-sm">
              No recommendation yet. One appears when a topic has enough graded work to compare.
            </p>
          )}
          <div className="border-border mt-4 border-t pt-4">
            <BriefButton courseId={o.courseId} />
          </div>
        </Panel>
      </div>

      <section className="mt-8 space-y-3" aria-labelledby="assignments-heading">
        <h2 id="assignments-heading" className="text-fg text-base font-semibold">
          Assignments
        </h2>
        {o.assignments.length === 0 ? (
          <EmptyState
            action={<TextLink href="/faculty/assignments/new">Create assignment</TextLink>}
          >
            No published assignments yet. Published and closed assignments appear here.
          </EmptyState>
        ) : (
          <Table caption="Assignment metrics">
            <THead>
              <tr>
                <TH>Assignment</TH>
                <TH>Completion</TH>
                <TH>First attempt</TH>
                <TH>Final</TH>
                <TH>Intervention level</TH>
              </tr>
            </THead>
            <TBody>
              {o.assignments.map((a) => (
                <TR key={a.assignmentId}>
                  <TD>
                    <Link
                      href={`/faculty/analytics${q}&assignmentId=${a.assignmentId}`}
                      className="hover:underline"
                    >
                      {a.title}
                    </Link>
                    <span className="text-fg-subtle ml-2 text-xs">
                      {a.state === "CLOSED" ? "Closed" : "Open"}
                    </span>
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
                    <DepthText metric={a.interventionDepth} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </>
  );
}

function comparisonSentence(o: CourseOverview): string {
  const a = o.firstAttemptCorrectness;
  const b = o.guidedRecovery;
  if (a.value === null || b.value === null) {
    return "Not enough students yet to compare first attempts with attempts after guidance.";
  }
  const diff = Math.round((b.value - a.value) * 100);
  const dir = diff >= 0 ? "higher" : "lower";
  return `Correctness after Socra and revision (${formatPct(b)}) was ${Math.abs(diff)} percentage points ${dir} than first-attempt correctness (${formatPct(a)}).`;
}
