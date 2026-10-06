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
import { CONDITIONS, listParticipants } from "@/server/domain/research/participants";
import { JsonForm } from "../../_components/json-form";

export const metadata = { title: "Participants and conditions" };
export const dynamic = "force-dynamic";

const CONDITION_LABEL: Record<string, string> = {
  CONTROL: "Control",
  UNRESTRICTED_AI: "Unrestricted AI",
  SOCRATIC_AI: "Socratic AI",
};
const CONSENT_LABEL: Record<string, string> = {
  NOT_ASKED: "Not asked",
  CONSENTED: "Consented",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; page?: string }>;
}) {
  const user = await requirePageUser("/research/participants");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const data = await listParticipants(user, { courseId: sp.courseId || undefined, page });
  const q = (p: number) => {
    const u = new URLSearchParams();
    if (sp.courseId) u.set("courseId", sp.courseId);
    u.set("page", String(p));
    return `/research/participants?${u.toString()}`;
  };

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Participants and conditions"
        meta="Pseudonymous ids only. Changing a condition needs a reason and is recorded permanently. Students cannot change their own condition."
      />

      <form method="get" className="flex items-end gap-3 text-sm">
        <label>
          <span className="mb-1 block font-medium">Course</span>
          <select
            name="courseId"
            defaultValue={sp.courseId ?? ""}
            className="border-border-input bg-surface h-8 rounded-sm border px-2"
          >
            <option value="">All courses</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="border-border-strong bg-surface hover:bg-surface-2 h-8 rounded-md border px-3"
        >
          Apply filter
        </button>
      </form>

      <Section
        title="Enrol students"
        id="enrol"
        meta="Adds active students who are not yet participants, keeping the three conditions balanced."
      >
        <Panel>
          <JsonForm
            url="/api/research/participants"
            inline
            testId="enrol-form"
            submitLabel="Enrol students"
            successMessage="Students enrolled."
            confirm="Enrol every active student of this course who is not yet a participant?"
            fields={[
              {
                name: "courseId",
                label: "Course",
                type: "select",
                required: true,
                defaultValue: sp.courseId ?? data.courses[0]?.id ?? "",
                options: data.courses.map((c) => ({ value: c.id, label: c.code })),
              },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Balance" id="balance">
        {data.balance.length === 0 ? (
          <EmptyState>No participants yet.</EmptyState>
        ) : (
          <Table caption="Participants per course and condition">
            <THead>
              <TR>
                <TH>Course</TH>
                <TH>Condition</TH>
                <TH numeric>Participants</TH>
              </TR>
            </THead>
            <TBody>
              {data.balance.map((b) => (
                <TR key={`${b.courseId}-${b.condition}`}>
                  <TD>{b.courseCode}</TD>
                  <TD>{CONDITION_LABEL[b.condition] ?? b.condition}</TD>
                  <TD numeric>{b.count}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Participants" id="participants" meta={`${data.total} total`}>
        {data.participants.length === 0 ? (
          <EmptyState>Nothing to show for this filter.</EmptyState>
        ) : (
          <Table caption="Study participants">
            <THead>
              <TR>
                <TH>Participant id</TH>
                <TH>Course</TH>
                <TH>Condition</TH>
                <TH>Consent</TH>
                <TH>Assigned</TH>
                <TH numeric>Changes</TH>
                <TH>Change condition</TH>
              </TR>
            </THead>
            <TBody>
              {data.participants.map((p) => (
                <TR key={p.id} data-testid="participant-row">
                  <TD className="text-code font-mono">{p.pseudonymousId}</TD>
                  <TD>{p.courseCode}</TD>
                  <TD>{CONDITION_LABEL[p.condition] ?? p.condition}</TD>
                  <TD>
                    {p.withdrawnAt ? (
                      <Badge tone="warning">Withdrawn</Badge>
                    ) : (
                      (CONSENT_LABEL[p.consentStatus] ?? p.consentStatus)
                    )}
                  </TD>
                  <TD>
                    <DateText date={p.assignedAt} />
                    <div className="text-fg-muted text-xs">{p.assignmentMethod}</div>
                  </TD>
                  <TD numeric>{p.changeCount}</TD>
                  <TD>
                    {p.withdrawnAt ? (
                      <span className="text-fg-muted">Withdrawn</span>
                    ) : (
                      <details>
                        <summary className="text-accent cursor-pointer text-sm">
                          Change<span className="sr-only"> condition for {p.pseudonymousId}</span>
                        </summary>
                        <div className="mt-2 w-72">
                          <JsonForm
                            url={`/api/research/participants/${p.id}/condition`}
                            submitLabel="Change condition"
                            variant="danger"
                            successMessage="Condition changed and recorded."
                            confirm="Change this participant's study condition? This is permanent and audited."
                            fields={[
                              {
                                name: "toCondition",
                                label: "New condition",
                                type: "select",
                                defaultValue:
                                  CONDITIONS.find((c) => c !== p.condition) ?? "CONTROL",
                                options: CONDITIONS.filter((c) => c !== p.condition).map((c) => ({
                                  value: c,
                                  label: CONDITION_LABEL[c] ?? c,
                                })),
                              },
                              {
                                name: "reason",
                                label: "Reason",
                                type: "textarea",
                                required: true,
                                help: "Be specific, for example the protocol deviation. At least 10 characters.",
                              },
                            ]}
                          />
                        </div>
                      </details>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <nav aria-label="Pagination" className="mt-3 flex items-center gap-4 text-sm">
          {data.page > 1 ? (
            <Link className="text-accent hover:underline" href={q(data.page - 1)}>
              Previous page
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {data.page} of {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <Link className="text-accent hover:underline" href={q(data.page + 1)}>
              Next page
            </Link>
          ) : null}
        </nav>
      </Section>
    </div>
  );
}
