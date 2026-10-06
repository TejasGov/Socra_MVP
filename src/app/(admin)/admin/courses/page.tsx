import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  Section,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { listAssignmentsForAdmin } from "@/server/domain/admin/assignments";
import { LANGUAGES, listCourses } from "@/server/domain/admin/courses";
import { ActionButton, JsonForm } from "../../_components/json-form";

export const metadata = { title: "Courses" };
export const dynamic = "force-dynamic";

const LANG_OPTIONS = LANGUAGES.map((l) => ({ value: l, label: l[0] + l.slice(1).toLowerCase() }));

export default async function Page() {
  const user = await requirePageUser("/admin/courses");
  const [courses, assignments] = await Promise.all([
    listCourses(user),
    listAssignmentsForAdmin(user),
  ]);

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader title="Courses" meta={`${courses.length} courses`} />

      <Section title="Create a course" id="create">
        <Panel>
          <JsonForm
            url="/api/admin/courses"
            testId="course-create"
            submitLabel="Create course"
            variant="primary"
            successMessage="Course created."
            fields={[
              { name: "code", label: "Code", required: true, placeholder: "CSE 115" },
              { name: "title", label: "Title", required: true },
              { name: "term", label: "Term", required: true, placeholder: "Fall 2026" },
              { name: "description", label: "Description", type: "textarea" },
              {
                name: "languages",
                label: "Languages",
                type: "checkboxes",
                options: LANG_OPTIONS,
                defaultValue: ["PYTHON"],
              },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Existing courses" id="courses">
        {courses.length === 0 ? (
          <EmptyState>No courses yet. Create one above, then import a roster.</EmptyState>
        ) : (
          <div className="space-y-4">
            {courses.map((c) => (
              <Panel
                key={c.id}
                titleAs="h3"
                title={`${c.code}: ${c.title}`}
                meta={`${c.term} · ${c.studentCount} students · ${c.assignmentCount} assignments · ${c.languages.join(", ")}`}
                actions={
                  c.isActive ? <Badge tone="success">Active</Badge> : <Badge>Archived</Badge>
                }
              >
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Instructors and TAs</h4>
                    {c.staff.length === 0 ? (
                      <p className="text-fg-muted text-sm">No staff. Add an instructor below.</p>
                    ) : (
                      <ul className="divide-border border-border divide-y rounded-md border">
                        {c.staff.map((s) => (
                          <li
                            key={s.membershipId}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                          >
                            <span>
                              {s.name} <span className="text-fg-muted">({s.email})</span>{" "}
                              <Badge>{s.role === "TA" ? "TA" : "Instructor"}</Badge>
                            </span>
                            <ActionButton
                              url={`/api/admin/courses/${c.id}/staff`}
                              method="DELETE"
                              body={{ userId: s.userId }}
                              label="Remove from course"
                              variant="danger"
                              confirm={`Remove ${s.name} from ${c.code}?`}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                    <JsonForm
                      url={`/api/admin/courses/${c.id}/staff`}
                      inline
                      submitLabel="Add staff member"
                      successMessage="Staff member added."
                      fields={[
                        {
                          name: "email",
                          label: "Email of existing user",
                          type: "email",
                          required: true,
                        },
                        {
                          name: "role",
                          label: "Role",
                          type: "select",
                          defaultValue: "INSTRUCTOR",
                          options: [
                            { value: "INSTRUCTOR", label: "Instructor" },
                            { value: "TA", label: "TA" },
                          ],
                        },
                      ]}
                    />
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">Edit course</summary>
                    <div className="mt-3">
                      <JsonForm
                        url={`/api/admin/courses/${c.id}`}
                        method="PATCH"
                        submitLabel="Save course"
                        fields={[
                          { name: "code", label: "Code", defaultValue: c.code },
                          { name: "title", label: "Title", defaultValue: c.title },
                          { name: "term", label: "Term", defaultValue: c.term },
                          {
                            name: "description",
                            label: "Description",
                            type: "textarea",
                            defaultValue: c.description ?? "",
                          },
                          {
                            name: "languages",
                            label: "Languages",
                            type: "checkboxes",
                            options: LANG_OPTIONS,
                            defaultValue: c.languages,
                          },
                          {
                            name: "isActive",
                            label: "Course is active",
                            type: "checkbox",
                            defaultValue: c.isActive,
                          },
                        ]}
                      />
                    </div>
                  </details>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Assignments"
        id="assignments"
        meta="Close or reopen an assignment for operational reasons. A reason is required and is written to the audit log."
      >
        {assignments.length === 0 ? (
          <EmptyState>No published assignments yet.</EmptyState>
        ) : (
          <Table caption="Assignments that can be closed or reopened">
            <THead>
              <TR>
                <TH>Course</TH>
                <TH>Assignment</TH>
                <TH>State</TH>
                <TH>Close</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <TBody>
              {assignments.map((a) => (
                <TR key={a.id}>
                  <TD>{a.course.code}</TD>
                  <TD>{a.title}</TD>
                  <TD>
                    {a.state === "PUBLISHED_PROTECTED"
                      ? "Open"
                      : a.state === "CLOSED"
                        ? "Closed"
                        : "Scheduled"}
                  </TD>
                  <TD>
                    {a.closeAt
                      ? a.closeAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
                      : "No close time"}
                  </TD>
                  <TD>
                    {a.state === "PUBLISHED_PROTECTED" || a.state === "CLOSED" ? (
                      <JsonForm
                        url={`/api/admin/assignments/${a.id}/state`}
                        inline
                        testId={`assignment-${a.id}-state`}
                        hidden={{ action: a.state === "CLOSED" ? "reopen" : "close" }}
                        submitLabel={
                          a.state === "CLOSED" ? "Reopen assignment" : "Close assignment"
                        }
                        variant="danger"
                        successMessage="Done."
                        fields={[{ name: "reason", label: "Reason", required: true }]}
                      />
                    ) : (
                      <span className="text-fg-muted">Not open yet</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
