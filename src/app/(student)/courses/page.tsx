import Link from "next/link";
import { EmptyState, PageHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { allAssignments, studentCourses } from "../_lib/student-data";

export const metadata = { title: "Courses" };

export default async function CoursesPage() {
  const user = await requirePageUser("/courses");
  const courses = await studentCourses(user);
  const assignments = await allAssignments(user, courses);

  return (
    <>
      <PageHeader title="Courses" meta={courses[0]?.term} />
      {courses.length === 0 ? (
        <EmptyState>
          You are not enrolled as a student in any pilot course. Ask your instructor to add you to
          the roster.
        </EmptyState>
      ) : (
        <Table caption="Your courses">
          <THead>
            <tr>
              <TH>Course</TH>
              <TH>Term</TH>
              <TH numeric>Open</TH>
              <TH numeric>Due in 7 days</TH>
              <TH numeric>Submitted</TH>
            </tr>
          </THead>
          <TBody>
            {courses.map((c) => {
              const mine = assignments.filter((a) => a.courseId === c.id);
              const open = mine.filter((a) => !a.isClosed);
              const soon = open.filter(
                (a) =>
                  a.dueAt &&
                  a.dueAt.getTime() - Date.now() < 7 * 24 * 3600 * 1000 &&
                  a.dueAt.getTime() > Date.now() &&
                  (a.progressStatus === "NOT_STARTED" || a.progressStatus === "IN_PROGRESS"),
              );
              const submitted = mine.filter(
                (a) => a.progressStatus === "SUBMITTED" || a.progressStatus === "RETURNED",
              );
              return (
                <TR key={c.id}>
                  <TD>
                    <Link
                      href={`/courses/${c.id}`}
                      className="font-medium text-fg hover:text-accent hover:underline"
                    >
                      {c.code}
                    </Link>{" "}
                    <span className="text-fg-muted">{c.title}</span>
                  </TD>
                  <TD className="text-fg-muted">{c.term}</TD>
                  <TD numeric>{open.length}</TD>
                  <TD numeric>{soon.length}</TD>
                  <TD numeric>{submitted.length}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
