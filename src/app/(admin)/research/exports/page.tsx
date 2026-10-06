import {
  Badge,
  DateText,
  EmptyState,
  PageHeader,
  Section,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { describeAllowlist, DEFAULT_EXPORT_FIELDS } from "@/server/domain/research/allowlist";
import { listResearchExports } from "@/server/domain/research/export";
import { assertCan } from "@/server/auth/rbac";
import { ExportForm } from "../../_components/export-form";

export const metadata = { title: "Research exports" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  REQUESTED: { label: "Queued", tone: "warning" },
  RUNNING: { label: "Running", tone: "warning" },
  COMPLETED: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export default async function Page() {
  const user = await requirePageUser("/research/exports");
  assertCan(user, "research:read");
  const [exports, courses, assignments] = await Promise.all([
    listResearchExports(user),
    prisma.course.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
    prisma.assignment.findMany({
      where: { state: { not: "DRAFT" } },
      select: { id: true, title: true, course: { select: { code: true } } },
      orderBy: [{ courseId: "asc" }, { title: "asc" }],
      take: 300,
    }),
  ]);
  const codeById = new Map(courses.map((c) => [c.id, c.code]));

  return (
    <div className="max-w-5xl space-y-10">
      <PageHeader
        title="Research exports"
        meta="Each export is versioned with a manifest and checksum, and both creating and downloading it are audited."
      />
      <Section title="New export" id="new">
        <ExportForm
          allowlist={describeAllowlist()}
          defaults={[...DEFAULT_EXPORT_FIELDS]}
          courses={courses}
          assignments={assignments.map((a) => ({
            id: a.id,
            title: a.title,
            courseCode: a.course.code,
          }))}
        />
      </Section>

      <Section title="Previous exports" id="history">
        {exports.length === 0 ? (
          <EmptyState>No exports have been created.</EmptyState>
        ) : (
          <Table caption="Research exports">
            <THead>
              <TR>
                <TH>Created</TH>
                <TH>Scope</TH>
                <TH>Format</TH>
                <TH numeric>Fields</TH>
                <TH numeric>Rows</TH>
                <TH>Dataset version</TH>
                <TH>Checksum (SHA-256)</TH>
                <TH>Status</TH>
                <TH>File</TH>
              </TR>
            </THead>
            <TBody>
              {exports.map((e) => (
                <TR key={e.id} data-testid="export-row">
                  <TD>
                    <DateText date={e.createdAt} />
                  </TD>
                  <TD>
                    {e.courseId ? (codeById.get(e.courseId) ?? "Course") : "All courses"}
                    <div className="text-fg-muted text-xs">
                      {[
                        e.filters.from ? `from ${e.filters.from.slice(0, 10)}` : null,
                        e.filters.to ? `until ${e.filters.to.slice(0, 10)}` : null,
                        e.filters.assignmentId ? "one assignment" : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </TD>
                  <TD>{e.format}</TD>
                  <TD numeric>{e.fields.length}</TD>
                  <TD numeric>{e.rowCount ?? "n/a"}</TD>
                  <TD>{e.datasetVersion ? `v${e.datasetVersion}` : "n/a"}</TD>
                  <TD className="font-mono text-xs break-all">
                    {e.checksum ? e.checksum.slice(0, 16) + "..." : "n/a"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS[e.status]?.tone ?? "neutral"}>
                      {STATUS[e.status]?.label ?? e.status}
                    </Badge>
                    {e.errorMessage ? (
                      <div className="text-danger text-xs">{e.errorMessage}</div>
                    ) : null}
                  </TD>
                  <TD>
                    {e.status === "COMPLETED" ? (
                      <a
                        className="text-accent underline"
                        href={`/api/research/exports/${e.id}/download`}
                      >
                        Download
                      </a>
                    ) : null}
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
