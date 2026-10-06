import Link from "next/link";
import { requirePageUser } from "@/server/auth/current-user";
import {
  getAssignmentAnalytics,
  getCourseOverview,
  type AssignmentAnalytics,
} from "@/server/domain/analytics";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { AnonymousScope, DepthText, MetricText } from "../analytics/_components/charts";
import { analyticsErrorMessage, pickCourse } from "../analytics/_components/course";

export const metadata = { title: "Question insights" };
export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const user = await requirePageUser("/faculty/insights");
  const { courseId } = await searchParams;
  const { course } = await pickCourse(user, courseId);
  if (!course) {
    return (
      <>
        <PageHeader title="Question insights" />
        <EmptyState>You are not on the teaching staff of any course yet.</EmptyState>
      </>
    );
  }
  let assignments: AssignmentAnalytics[];
  try {
    const overview = await getCourseOverview(user, course.id);
    assignments = await Promise.all(
      overview.assignments.map((a) => getAssignmentAnalytics(user, a.assignmentId)),
    );
  } catch (err) {
    const message = analyticsErrorMessage(err);
    if (!message) throw err;
    return (
      <>
        <PageHeader title="Question insights" />
        <ErrorState title="Question insights unavailable">{message}</ErrorState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Question insights"
        meta={`${course.code} · every question in published or closed assignments`}
      >
        <AnonymousScope />
      </PageHeader>
      {assignments.length === 0 ? (
        <EmptyState>
          No published assignments yet. Questions appear here once an assignment is published.
        </EmptyState>
      ) : (
        <Table caption="Questions">
          <THead>
            <tr>
              <TH>Question</TH>
              <TH>Assignment</TH>
              <TH>First attempt</TH>
              <TH>Final</TH>
              <TH>Intervention level</TH>
            </tr>
          </THead>
          <TBody>
            {assignments.flatMap((a) =>
              a.questions.map((q, i) => (
                <TR key={q.questionId}>
                  <TD>
                    <Link
                      href={`/faculty/insights/questions/${q.questionId}`}
                      data-testid="question-drilldown-link"
                      className="hover:underline"
                    >
                      Q{i + 1}. {q.title}
                    </Link>
                  </TD>
                  <TD className="text-fg-muted">{a.title}</TD>
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
              )),
            )}
          </TBody>
        </Table>
      )}
    </>
  );
}
