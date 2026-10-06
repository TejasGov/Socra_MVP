import Link from "next/link";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { listCourseResources } from "@/server/domain/resources/ingest";
import { Badge, EmptyState, PageHeader, Panel, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { AddResourceForm } from "./add-resource-form";

export const metadata = { title: "Course materials" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  LECTURE_NOTES: "Lecture notes",
  SLIDES: "Slides",
  READING: "Reading",
  EXAMPLE_CODE: "Example code",
  LINK: "Link",
  DOCUMENT: "Document",
  OTHER: "Other",
};

const SCOPE_LABEL: Record<string, string> = {
  COURSE_ALL: "All students",
  STAFF_ONLY: "Staff only",
  ASSIGNMENT_SCOPED: "Selected assignments",
};

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const user = await requirePageUser("/faculty/materials");
  const { course: courseParam } = await searchParams;
  const staffCourseIds = user.memberships
    .filter((m) => m.status === "ACTIVE" && (m.role === "INSTRUCTOR" || m.role === "TA"))
    .map((m) => m.courseId);
  const courses = await prisma.course.findMany({
    where: { id: { in: staffCourseIds } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, title: true, term: true },
  });
  const course = courses.find((c) => c.id === courseParam) ?? courses[0];

  if (!course) {
    return (
      <>
        <PageHeader title="Course materials" />
        <EmptyState>You are not a staff member of any course yet.</EmptyState>
      </>
    );
  }

  const canManage = user.memberships.some(
    (m) => m.courseId === course.id && m.status === "ACTIVE" && m.role === "INSTRUCTOR",
  );
  const [resources, topics] = await Promise.all([
    listCourseResources(user, course.id),
    prisma.topic.findMany({
      where: { courseId: course.id },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Course materials"
        meta={`${course.code} · ${course.term} · Socra cites these when it answers students in this course only.`}
      />
      {courses.length > 1 ? (
        <nav aria-label="Course" className="mb-4 flex flex-wrap gap-2 text-sm">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/faculty/materials?course=${c.id}`}
              aria-current={c.id === course.id ? "page" : undefined}
              className={
                c.id === course.id
                  ? "rounded-md bg-accent-subtle px-2 py-1 text-accent"
                  : "rounded-md px-2 py-1 text-fg-muted hover:bg-surface-2"
              }
            >
              {c.code}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="resources-heading" className="min-w-0 space-y-3">
          <h2 id="resources-heading" className="text-base font-semibold">
            Resources ({resources.length})
          </h2>
          {resources.length === 0 ? (
            <EmptyState>No materials yet. Paste text or upload a .md or .txt file to add the first one.</EmptyState>
          ) : (
            <Table caption="Course resources">
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH>Topics</TH>
                  <TH>Visible to</TH>
                  <TH numeric>Version</TH>
                  <TH numeric>Chunks</TH>
                </TR>
              </THead>
              <TBody>
                {resources.map((r) => (
                  <TR key={r.id} data-testid="resource-row">
                    <TD>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-fg-subtle">
                        {TYPE_LABEL[r.type] ?? r.type}
                        {r.lecture ? ` · ${r.lecture}` : ""}
                        {r.week != null ? ` · Week ${r.week}` : ""}
                      </div>
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          r.status === "READY"
                            ? "success"
                            : r.status === "FAILED"
                              ? "danger"
                              : r.status === "ARCHIVED"
                                ? "neutral"
                                : "warning"
                        }
                      >
                        {r.status === "READY" ? "Indexed" : r.status === "ARCHIVED" ? "Archived" : r.status === "FAILED" ? "Failed" : "Processing"}
                      </Badge>
                    </TD>
                    <TD>
                      {r.topics.length ? (
                        r.topics.map((t) => t.name).join(", ")
                      ) : (
                        <span className="text-fg-subtle">No topics</span>
                      )}
                    </TD>
                    <TD>{SCOPE_LABEL[r.accessScope] ?? r.accessScope}</TD>
                    <TD numeric>v{r.version}</TD>
                    <TD numeric>
                      {r.chunkCount}
                      {r.embeddedChunkCount > 0 ? (
                        <span className="text-xs text-fg-subtle"> ({r.embeddedChunkCount} embedded)</span>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <aside>
          {canManage ? (
            <Panel title="Add a resource" meta=".md or .txt, up to 1 MB. Other formats are not supported yet.">
              <AddResourceForm
                courseId={course.id}
                topics={topics}
                existing={resources
                  .filter((r) => r.status !== "ARCHIVED")
                  .map((r) => ({ id: r.id, title: r.title }))}
              />
            </Panel>
          ) : (
            <EmptyState>Only instructors can add or change course materials.</EmptyState>
          )}
        </aside>
      </div>
    </>
  );
}
