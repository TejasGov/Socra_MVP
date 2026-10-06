import Link from "next/link";
import { PageHeader, Section, Table, TBody, TD, TH, THead, TR, Badge } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getAdminOverview } from "@/server/domain/admin/overview";

export const metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const LINKS = [
  [
    "/admin/courses",
    "Courses and assignments",
    "Create courses, set languages, manage instructors and TAs, close or reopen assignments.",
  ],
  [
    "/admin/roster",
    "Roster and roles",
    "Import a roster CSV, grant roles, issue time-limited transcript access.",
  ],
  [
    "/admin/flags",
    "Feature flags",
    "Environment default, course overrides and the effective value.",
  ],
  ["/admin/ai", "AI configuration", "Models, mock mode, course budgets, kill switch."],
  ["/admin/usage", "AI usage", "Requests, tokens, cost, failures and latency."],
  ["/admin/audit", "Audit log", "Privileged actions, filterable."],
  ["/admin/jobs", "Job failures", "Failed jobs, outbox status, queue depths."],
  ["/admin/health", "System health", "App, database, Redis, worker, runner, AI mode."],
] as const;

export default async function Page() {
  const user = await requirePageUser("/admin");
  const o = await getAdminOverview(user);
  const failRate = o.ai24h > 0 ? `${Math.round((o.aiFailed24h / o.ai24h) * 100)}%` : "no requests";
  return (
    <div className="max-w-5xl">
      <PageHeader title="Administration" meta="Counts are live from the database." />
      <Section title="Right now" id="now">
        <Table caption="Operational summary">
          <THead>
            <TR>
              <TH>Item</TH>
              <TH numeric>Value</TH>
              <TH>Where</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>Active courses</TD>
              <TD numeric>{o.courses}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/courses">
                  Courses
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>Unresolved job failures</TD>
              <TD numeric>{o.openJobFailures}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/jobs">
                  Job failures
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>Failed outbox events</TD>
              <TD numeric>{o.failedOutbox}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/jobs">
                  Job failures
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>Quarantined events</TD>
              <TD numeric>{o.quarantined}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/jobs">
                  Job failures
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>AI requests, last 24 hours</TD>
              <TD numeric>
                {o.ai24h} ({failRate} failed)
              </TD>
              <TD>
                <Link className="text-accent underline" href="/admin/usage">
                  AI usage
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>AI kill switch</TD>
              <TD numeric>{o.killSwitch ? <Badge tone="danger">On</Badge> : <Badge>Off</Badge>}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/ai">
                  AI configuration
                </Link>
              </TD>
            </TR>
            <TR>
              <TD>Audit entries, last 24 hours</TD>
              <TD numeric>{o.recentAudit}</TD>
              <TD>
                <Link className="text-accent underline" href="/admin/audit">
                  Audit log
                </Link>
              </TD>
            </TR>
          </TBody>
        </Table>
      </Section>
      <Section title="Tools" id="tools" className="mt-8">
        <ul className="divide-border border-border bg-surface divide-y rounded-lg border">
          {LINKS.map(([href, label, text]) => (
            <li key={href} className="px-4 py-3">
              <Link href={href} className="text-accent font-medium hover:underline">
                {label}
              </Link>
              <p className="text-fg-muted text-sm">{text}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
