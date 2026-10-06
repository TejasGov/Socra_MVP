import {
  Badge,
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
import { getSystemHealth } from "@/server/domain/admin/system-health";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

function Status({ ok, label }: { ok: boolean; label?: string }) {
  const tone: BadgeTone = ok ? "success" : "danger";
  return <Badge tone={tone}>{label ?? (ok ? "OK" : "Down")}</Badge>;
}

export default async function Page() {
  const user = await requirePageUser("/admin/health");
  const h = await getSystemHealth(user);
  const worker = h.worker;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="System health"
        meta={`Checked ${new Date(h.app.time).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })} (UTC). Reload the page to check again.`}
      />
      <Table caption="Service health">
        <THead>
          <TR>
            <TH>Component</TH>
            <TH>Status</TH>
            <TH>Detail</TH>
          </TR>
        </THead>
        <TBody>
          <TR data-testid="health-app">
            <TD>App</TD>
            <TD>
              <Status
                ok={h.app.status !== "down"}
                label={
                  h.app.status === "ok" ? "OK" : h.app.status === "degraded" ? "Degraded" : "Down"
                }
              />
            </TD>
            <TD className="text-fg-muted">Version {h.app.appVersion}</TD>
          </TR>
          <TR data-testid="health-db">
            <TD>Database</TD>
            <TD>
              <Status ok={h.app.checks.database.ok} />
            </TD>
            <TD className="text-fg-muted">
              {h.app.checks.database.ok
                ? `${h.app.checks.database.latencyMs} ms`
                : h.app.checks.database.error}
            </TD>
          </TR>
          <TR data-testid="health-redis">
            <TD>Redis</TD>
            <TD>
              <Status ok={h.app.checks.redis.ok} />
            </TD>
            <TD className="text-fg-muted">
              {h.app.checks.redis.ok
                ? "Queues available"
                : "Queues, code runs and background jobs are unavailable"}
            </TD>
          </TR>
          <TR data-testid="health-worker">
            <TD>Worker</TD>
            <TD>
              <Status
                ok={worker.reachable && worker.status !== "down"}
                label={
                  worker.reachable
                    ? worker.status === "ok"
                      ? "OK"
                      : (worker.status ?? "Unknown")
                    : "Unreachable"
                }
              />
            </TD>
            <TD className="text-fg-muted">
              {worker.reachable
                ? `Responding at ${worker.url}`
                : `${worker.error ?? "No response"} at ${worker.url}`}
            </TD>
          </TR>
          <TR data-testid="health-runner">
            <TD>Code runner</TD>
            <TD>
              <Status
                ok={h.runner.executing}
                label={h.runner.executing ? "Available" : "Unavailable"}
              />
            </TD>
            <TD className="text-fg-muted">
              Driver: {h.runner.driver}.{" "}
              {h.runner.executing
                ? h.runner.driver === "docker"
                  ? "Runs execute in the worker."
                  : h.runner.driver === "vercel-sandbox"
                    ? "Each run executes in its own Vercel Sandbox microVM (Python and JavaScript; no Scala)."
                    : "Runs execute in the remote sandbox service."
                : "Runs report RUNNER_UNAVAILABLE; students keep their work and no output is invented."}
            </TD>
          </TR>
          <TR data-testid="health-ai">
            <TD>AI</TD>
            <TD>
              {h.ai.killSwitch ? (
                <Badge tone="danger">Kill switch on</Badge>
              ) : h.ai.mockMode ? (
                <Badge tone="warning">Mock mode</Badge>
              ) : (
                <Badge tone="success">Live provider</Badge>
              )}
            </TD>
            <TD className="text-fg-muted">
              {h.ai.killSwitch
                ? "AI requests are refused. Assignment work is unaffected."
                : h.ai.mockMode
                  ? "Answers come from the deterministic mock provider."
                  : "Requests go to the configured provider."}
            </TD>
          </TR>
          <TR>
            <TD>Sign-in</TD>
            <TD>
              <Status ok={h.app.checks.auth.localEnabled || h.app.checks.auth.oidcConfigured} />
            </TD>
            <TD className="text-fg-muted">
              Local: {h.app.checks.auth.localEnabled ? "enabled" : "disabled"}. OIDC:{" "}
              {h.app.checks.auth.oidcConfigured ? "configured" : "not configured"}.
            </TD>
          </TR>
        </TBody>
      </Table>
      {h.app.warnings.length > 0 ? (
        <div className="mt-6">
          <h2 className="mb-2 text-base font-semibold">Configuration warnings</h2>
          <ul className="text-fg-muted list-disc space-y-1 pl-5 text-sm">
            {h.app.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
