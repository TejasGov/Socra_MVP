import Link from "next/link";
import { Plus } from "lucide-react";
import {
  Badge,
  DateText,
  EmptyState,
  LinkButton,
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
import { can } from "@/server/auth/rbac";
import { listAssignmentsForFaculty } from "@/server/domain/assignments/service";
import { syncCourseAssignments } from "@/server/domain/assignments/service";

export const metadata = { title: "Assignments" };
export const dynamic = "force-dynamic";

const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "accent" },
  PUBLISHED_PROTECTED: { label: "Published", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const user = await requirePageUser("/faculty/assignments");
  const courseIds = [
    ...new Set(user.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.courseId)),
  ];
  await Promise.all(courseIds.map((c) => syncCourseAssignments(c)));
  const rows = await listAssignmentsForFaculty(user, { includeArchived: showArchived });
  const canCreate = user.memberships.some(
    (m) => m.role === "INSTRUCTOR" && can(user, "assignment:create", { courseId: m.courseId }),
  );
  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title="Assignments"
        meta={
          <>
            Draft, published and closed assignments across your courses.{" "}
            {showArchived ? (
              <Link className="text-accent hover:underline" href="/faculty/assignments">
                Hide archived
              </Link>
            ) : (
              <Link className="text-accent hover:underline" href="/faculty/assignments?archived=1">
                Show archived
              </Link>
            )}
          </>
        }
        actions={
          canCreate ? (
            <LinkButton
              href="/faculty/assignments/new"
              variant="primary"
              size="lg"
              icon={<Plus size={16} />}
              data-testid="create-assignment"
            >
              Create assignment
            </LinkButton>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          action={
            canCreate ? (
              <LinkButton href="/faculty/assignments/new">Create assignment</LinkButton>
            ) : undefined
          }
        >
          No assignments yet. Created assignments are listed here with their state and submission
          counts.
        </EmptyState>
      ) : (
        <Table caption="Assignments">
          <THead>
            <TR>
              <TH>Assignment</TH>
              <TH>Course</TH>
              <TH>State</TH>
              <TH>Due</TH>
              <TH numeric>Points</TH>
              <TH numeric>Started</TH>
              <TH numeric>Submitted</TH>
              <TH numeric>Graded</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const s = STATE[r.state] ?? { label: r.state, tone: "neutral" as BadgeTone };
              return (
                <TR key={r.id}>
                  <TD>
                    <Link
                      className="text-fg font-medium hover:underline"
                      href={`/faculty/assignments/${r.id}/edit`}
                    >
                      {r.title}
                    </Link>
                    <p className="text-fg-subtle text-xs">
                      {r.format === "CODING"
                        ? "Coding"
                        : r.format === "WRITTEN"
                          ? "Written"
                          : "Quiz"}{" "}
                      · {r.questionCount} question{r.questionCount === 1 ? "" : "s"}
                    </p>
                  </TD>
                  <TD>{r.courseCode}</TD>
                  <TD>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {r.state === "CLOSED" ? (
                      <p className="text-fg-subtle mt-0.5 text-xs">
                        {r.solutionsReleased ? "Solutions released" : "Solutions held"}
                      </p>
                    ) : null}
                  </TD>
                  <TD>
                    {r.dueAt ? (
                      <DateText date={r.dueAt} />
                    ) : (
                      <span className="text-fg-subtle">No due date</span>
                    )}
                  </TD>
                  <TD numeric>{r.totalPoints}</TD>
                  <TD numeric>
                    {r.startedCount} / {r.enrolledCount}
                  </TD>
                  <TD numeric>
                    {r.submittedCount} / {r.enrolledCount}
                  </TD>
                  <TD numeric>{r.gradedCount}</TD>
                  <TD>
                    <div className="flex justify-end gap-3 text-sm">
                      <Link
                        className="text-accent hover:underline"
                        href={`/faculty/assignments/${r.id}/preview`}
                      >
                        Preview
                      </Link>
                      {r.state !== "DRAFT" && r.state !== "ARCHIVED" ? (
                        <Link
                          className="text-accent hover:underline"
                          href={`/faculty/assignments/${r.id}/submissions`}
                        >
                          Submissions
                        </Link>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
