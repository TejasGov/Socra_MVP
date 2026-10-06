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
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getJobsOverview } from "@/server/domain/admin/jobs";
import { ActionButton } from "../../_components/json-form";

export const metadata = { title: "Job failures" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requirePageUser("/admin/jobs");
  const o = await getJobsOverview(user);
  const failedOutbox = o.outbox.problemRows.filter((r) => r.status === "FAILED");

  return (
    <div className="max-w-6xl space-y-10">
      <PageHeader
        title="Job failures"
        meta={`${o.unresolvedCount} unresolved job failure${o.unresolvedCount === 1 ? "" : "s"}`}
      />

      <Section title="Background job failures" id="failures">
        {o.failures.length === 0 ? (
          <EmptyState>No job has failed.</EmptyState>
        ) : (
          <Table caption="Failed background jobs">
            <THead>
              <TR>
                <TH>Failed</TH>
                <TH>Queue</TH>
                <TH>Job</TH>
                <TH numeric>Attempts</TH>
                <TH>Error</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {o.failures.map((f) => (
                <TR key={f.id}>
                  <TD>
                    <DateText date={f.failedAt} />
                  </TD>
                  <TD>{f.queue}</TD>
                  <TD>
                    {f.jobName}
                    {f.jobId ? (
                      <div className="text-fg-muted font-mono text-xs">{f.jobId}</div>
                    ) : null}
                  </TD>
                  <TD numeric>{f.attempts}</TD>
                  <TD className="text-fg-muted max-w-sm break-words">{f.error}</TD>
                  <TD>
                    {f.resolvedAt ? (
                      <Badge tone="success">Resolved</Badge>
                    ) : (
                      <ActionButton
                        url="/api/admin/jobs"
                        body={{ action: "resolve_failure", failureId: f.id }}
                        label="Mark resolved"
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section
        title="Event outbox"
        id="outbox"
        meta="Events are written with the data they describe and delivered to consumers by the worker. Quarantined events are invalid and are never retried."
      >
        <Table caption="Outbox status counts">
          <THead>
            <TR>
              {Object.keys(o.outbox.counts).map((s) => (
                <TH key={s} numeric>
                  {s.toLowerCase()}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            <TR>
              {Object.values(o.outbox.counts).map((n, i) => (
                <TD key={i} numeric>
                  {n}
                </TD>
              ))}
            </TR>
          </TBody>
        </Table>
        {failedOutbox.length > 0 ? (
          <div className="mt-3 space-y-3">
            <ActionButton
              url="/api/admin/jobs"
              body={{ action: "retry_outbox" }}
              label={`Retry all ${failedOutbox.length} failed events`}
              variant="primary"
              size="md"
              testId="outbox-retry-all"
            />
            <Table caption="Failed and quarantined outbox rows">
              <THead>
                <TR>
                  <TH>Created</TH>
                  <TH>Event</TH>
                  <TH>Status</TH>
                  <TH numeric>Attempts</TH>
                  <TH>Last error</TH>
                  <TH>Action</TH>
                </TR>
              </THead>
              <TBody>
                {o.outbox.problemRows.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <DateText date={r.createdAt} />
                    </TD>
                    <TD>{r.eventName}</TD>
                    <TD>
                      {r.status === "FAILED" ? (
                        <Badge tone="danger">Failed</Badge>
                      ) : (
                        <Badge tone="warning">Quarantined</Badge>
                      )}
                    </TD>
                    <TD numeric>
                      {r.attempts} / {r.maxAttempts}
                    </TD>
                    <TD className="text-fg-muted max-w-sm break-words">{r.lastError ?? ""}</TD>
                    <TD>
                      {r.status === "FAILED" ? (
                        <ActionButton
                          url="/api/admin/jobs"
                          body={{ action: "retry_outbox", ids: [r.id] }}
                          label="Retry event"
                        />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="text-fg-muted mt-2 text-sm">No failed outbox events.</p>
        )}
      </Section>

      <Section title="Queue depths" id="queues">
        {!o.queues.available ? (
          <EmptyState>Redis is not reachable, so queue depths are unavailable.</EmptyState>
        ) : (
          <Table caption="Queue depths">
            <THead>
              <TR>
                <TH>Queue</TH>
                <TH numeric>Waiting</TH>
                <TH numeric>Active</TH>
                <TH numeric>Delayed</TH>
                <TH numeric>Failed</TH>
                <TH numeric>Completed (retained)</TH>
              </TR>
            </THead>
            <TBody>
              {o.queues.queues.map((q) => (
                <TR key={q.name}>
                  <TD>{q.name}</TD>
                  <TD numeric>{q.counts.waiting ?? "n/a"}</TD>
                  <TD numeric>{q.counts.active ?? "n/a"}</TD>
                  <TD numeric>{q.counts.delayed ?? "n/a"}</TD>
                  <TD numeric>{q.counts.failed ?? "n/a"}</TD>
                  <TD numeric>{q.counts.completed ?? "n/a"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
