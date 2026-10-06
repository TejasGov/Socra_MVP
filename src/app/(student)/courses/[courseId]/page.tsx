import Link from "next/link";
import { notFound } from "next/navigation";
import {
  EmptyState,
  LinkButton,
  PageHeader,
  Section,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getCourseForUser, type AssignmentCard } from "@/server/domain/assignments/queries";
import { DueCell, ModeCell, ScoreCell, StatusCell, formatLabel } from "../../_lib/assignment-bits";
import { assignmentHref, practiceHref } from "../../_lib/student-data";

export const metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const user = await requirePageUser(`/courses/${courseId}`);
  const course = await getCourseForUser(user, courseId);
  if (!course) notFound();

  const open = course.assignments.filter((a) => !a.isClosed);
  const closed = course.assignments.filter((a) => a.isClosed);

  return (
    <>
      <PageHeader
        back={{ href: "/courses", label: "Courses" }}
        title={`${course.code} ${course.title}`}
        meta={`${course.term} · ${course.assignments.length} assignment${course.assignments.length === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href={`/profile?courseId=${course.id}`} variant="ghost">
              View learning profile
            </LinkButton>
            <LinkButton href={practiceHref(course.id)}>Practice this course</LinkButton>
          </>
        }
      />

      {course.description ? (
        <p className="mb-8 max-w-[68ch] text-sm text-fg-muted">{course.description}</p>
      ) : null}

      <div className="space-y-8">
        <Section id="assignments" title="Open assignments">
          {open.length === 0 ? (
            <EmptyState>No open assignments in {course.code}. Published assignments appear here.</EmptyState>
          ) : (
            <AssignmentTable rows={open} caption={`Open assignments in ${course.code}`} />
          )}
        </Section>

        {closed.length > 0 ? (
          <Section
            id="closed"
            title="Closed assignments"
            meta="Closed assignments open in review mode once your instructor releases solutions."
          >
            <AssignmentTable rows={closed} caption={`Closed assignments in ${course.code}`} />
          </Section>
        ) : null}
      </div>
    </>
  );
}

function AssignmentTable({
  rows,
  caption,
}: {
  rows: AssignmentCard[];
  caption: string;
}) {
  return (
    <Table caption={caption}>
      <THead>
        <tr>
          <TH>Assignment</TH>
          <TH>Type</TH>
          <TH>Due</TH>
          <TH>Status</TH>
          <TH numeric>Attempts</TH>
          <TH numeric>Score</TH>
          <TH>Socra</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((a) => (
          <TR key={a.id}>
            <TD>
              <Link
                href={assignmentHref(a)}
                className="font-medium text-fg hover:text-accent hover:underline"
              >
                {a.title}
              </Link>
              <span className="block text-xs text-fg-subtle tabular-nums">
                {a.questionCount} question{a.questionCount === 1 ? "" : "s"} · {a.totalPoints} pts
                {a.estimatedMinutes ? ` · about ${a.estimatedMinutes} min` : ""}
              </span>
            </TD>
            <TD className="text-fg-muted">{formatLabel(a)}</TD>
            <TD>
              <DueCell a={a} />
            </TD>
            <TD>
              <StatusCell a={a} />
            </TD>
            <TD numeric className="text-fg-muted">
              {a.attemptsUsed}
              {a.attemptLimit !== null ? ` of ${a.attemptLimit}` : " (no limit)"}
            </TD>
            <TD numeric>
              <ScoreCell a={a} />
            </TD>
            <TD>
              <ModeCell a={a} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
