import Link from "next/link";
import {
  Badge,
  DateText,
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
import { listCourses } from "@/server/domain/admin/courses";
import { GLOBAL_ROLES, listPrivilegedGrants, listUsersForAdmin } from "@/server/domain/admin/roles";
import { getRosterImport, listRosterImports } from "@/server/domain/admin/roster";
import { ActionButton, JsonForm } from "../../_components/json-form";
import { RosterUploader } from "../../_components/roster-uploader";

export const metadata = { title: "Roster and roles" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  STUDENT: "Student",
  TA: "TA",
  INSTRUCTOR: "Instructor",
  RESEARCH_ADMIN: "Research administrator",
  SYSTEM_ADMIN: "System administrator",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; report?: string }>;
}) {
  const user = await requirePageUser("/admin/roster");
  const { q, report } = await searchParams;
  const [courses, imports, users, grants] = await Promise.all([
    listCourses(user),
    listRosterImports(user),
    listUsersForAdmin(user, q),
    listPrivilegedGrants(user),
  ]);
  const reportImport = report ? await getRosterImport(user, report).catch(() => null) : null;

  return (
    <div className="max-w-5xl space-y-10">
      <PageHeader
        title="Roster and roles"
        meta="Roster imports never show internal ids to students. Every change here is audited."
      />

      <Section title="Import a roster" id="import">
        {courses.length === 0 ? (
          <EmptyState>Create a course first, then import its roster.</EmptyState>
        ) : (
          <RosterUploader
            courses={courses.map((c) => ({ id: c.id, code: c.code, title: c.title }))}
          />
        )}
      </Section>

      <Section title="Import history" id="history">
        {imports.length === 0 ? (
          <EmptyState>No imports yet.</EmptyState>
        ) : (
          <Table caption="Recent roster imports">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Course</TH>
                <TH>File</TH>
                <TH>Status</TH>
                <TH numeric>Rows</TH>
                <TH numeric>Valid</TH>
                <TH numeric>Duplicates</TH>
                <TH numeric>Errors</TH>
                <TH>
                  <span className="sr-only">Report</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {imports.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <DateText date={i.createdAt} />
                  </TD>
                  <TD>{i.course.code}</TD>
                  <TD>{i.fileName}</TD>
                  <TD>
                    {i.status === "APPLIED" ? (
                      <Badge tone="success">Applied</Badge>
                    ) : (
                      <Badge tone="warning">Not applied</Badge>
                    )}
                  </TD>
                  <TD numeric>{i.rowCount}</TD>
                  <TD numeric>{i.validCount}</TD>
                  <TD numeric>{i.duplicateCount}</TD>
                  <TD numeric>{i.errorCount}</TD>
                  <TD>
                    <Link
                      className="text-accent hover:underline"
                      href={`?report=${i.id}#report`}
                    >
                      View report<span className="sr-only"> for {i.fileName}</span>
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {reportImport ? (
          <div id="report" className="space-y-2">
            <h3 className="text-fg text-sm font-semibold">Report for {reportImport.fileName}</h3>
            <Table caption={`Row results for ${reportImport.fileName}`}>
              <THead>
                <TR>
                  <TH numeric>Row</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Result</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {reportImport.rows.map((r) => (
                  <TR key={r.id}>
                    <TD numeric>{r.rowNumber}</TD>
                    <TD>{r.email ?? "None"}</TD>
                    <TD>{r.role ? (ROLE_LABEL[r.role] ?? r.role) : "None"}</TD>
                    <TD>{r.status}</TD>
                    <TD>{r.errors.length ? r.errors.join(", ") : "No issues"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </Section>

      <Section
        title="Global roles"
        id="roles"
        meta="Showing administrators, research administrators, instructors and TAs. Search to find anyone else."
      >
        <form method="get" className="mb-3 flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Search by name or email</span>
            <input
              name="q"
              defaultValue={q ?? ""}
              className="border-border-input bg-surface h-8 w-72 rounded-sm border px-2.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="border-border-strong bg-surface hover:bg-surface-2 h-8 rounded-md border px-3 text-sm"
          >
            Search users
          </button>
        </form>
        <Table caption="Users and global roles">
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Roles</TH>
              <TH>Change a role</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD>
                  {u.name}
                  <div className="text-fg-muted text-xs">{u.email}</div>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r}>{ROLE_LABEL[r] ?? r}</Badge>
                    ))}
                    {!u.isActive ? <Badge tone="warning">Deactivated</Badge> : null}
                  </div>
                </TD>
                <TD>
                  <details>
                    <summary className="text-accent cursor-pointer text-sm">
                      Grant or revoke
                    </summary>
                    <div className="mt-2">
                      <JsonForm
                        url="/api/admin/roles"
                        inline
                        hidden={{ userId: u.id }}
                        submitLabel="Apply role change"
                        successMessage="Role changed."
                        fields={[
                          {
                            name: "action",
                            label: "Action",
                            type: "select",
                            defaultValue: "grant",
                            options: [
                              { value: "grant", label: "Grant" },
                              { value: "revoke", label: "Revoke" },
                            ],
                          },
                          {
                            name: "role",
                            label: "Role",
                            type: "select",
                            defaultValue: "RESEARCH_ADMIN",
                            options: GLOBAL_ROLES.map((r) => ({
                              value: r,
                              label: ROLE_LABEL[r] ?? r,
                            })),
                          },
                          { name: "reason", label: "Reason", required: true },
                        ]}
                      />
                    </div>
                  </details>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {users.length === 0 ? <p className="text-fg-muted mt-2 text-sm">No users match.</p> : null}
      </Section>

      <Section
        title="Raw transcript access"
        id="grants"
        meta="Reading a raw Socra conversation needs a system or research administrator role, an unexpired grant, and a reason on every read. Grants last at most 90 days."
      >
        <Panel title="Grant access" titleAs="h3">
          <JsonForm
            url="/api/admin/grants"
            testId="grant-create"
            submitLabel="Create grant"
            variant="primary"
            successMessage="Grant created."
            hidden={{ permission: "TRANSCRIPT_READ_RAW" }}
            fields={[
              {
                name: "userId",
                label: "Holder",
                type: "select",
                required: true,
                options: users
                  .filter(
                    (u) => u.roles.includes("SYSTEM_ADMIN") || u.roles.includes("RESEARCH_ADMIN"),
                  )
                  .map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
              },
              {
                name: "reason",
                label: "Reason",
                type: "textarea",
                required: true,
                help: "State the incident or protocol. At least 10 characters.",
              },
              { name: "protocolReference", label: "Protocol or ticket reference" },
              { name: "expiresAt", label: "Expires", type: "datetime-local", required: true },
            ]}
          />
        </Panel>
        <div className="mt-4">
          {grants.length === 0 ? (
            <EmptyState>No grants have been issued.</EmptyState>
          ) : (
            <Table caption="Privileged access grants">
              <THead>
                <TR>
                  <TH>Holder</TH>
                  <TH>Reason</TH>
                  <TH>Granted by</TH>
                  <TH>Expires</TH>
                  <TH>Status</TH>
                  <TH>Action</TH>
                </TR>
              </THead>
              <TBody>
                {grants.map((g) => (
                  <TR key={g.id}>
                    <TD>
                      {g.holderName}
                      <div className="text-fg-muted text-xs">{g.holderEmail}</div>
                    </TD>
                    <TD>
                      {g.reason}
                      {g.protocolReference ? (
                        <div className="text-fg-muted text-xs">Ref: {g.protocolReference}</div>
                      ) : null}
                    </TD>
                    <TD>{g.grantedByEmail}</TD>
                    <TD>
                      <DateText date={g.expiresAt} />
                    </TD>
                    <TD>
                      {g.revokedAt ? (
                        <Badge>Revoked</Badge>
                      ) : g.active ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge>Expired</Badge>
                      )}
                    </TD>
                    <TD>
                      {g.active ? (
                        <ActionButton
                          url="/api/admin/grants"
                          method="DELETE"
                          body={{ grantId: g.id, reason: "Revoked from admin console" }}
                          label="Revoke grant"
                          variant="danger"
                          confirm="Revoke this grant now?"
                        />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Section>
    </div>
  );
}
