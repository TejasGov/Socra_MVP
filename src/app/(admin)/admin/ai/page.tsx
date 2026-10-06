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
import { getAiAdminState } from "@/server/domain/admin/ai";
import { JsonForm } from "../../_components/json-form";

export const metadata = { title: "AI configuration" };
export const dynamic = "force-dynamic";

const dateInput = (d: Date) => d.toISOString().slice(0, 10);

export default async function Page() {
  const user = await requirePageUser("/admin/ai");
  const s = await getAiAdminState(user);
  const now = new Date();
  const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 1));

  return (
    <div className="max-w-5xl space-y-10">
      <PageHeader
        title="AI configuration"
        meta="The provider key is never shown here, only whether it is set."
      />

      <Section title="Status" id="status">
        <Table caption="AI status">
          <TBody>
            <TR>
              <TH scope="row">Mode</TH>
              <TD>
                {s.mockMode.enabled ? (
                  <Badge tone="warning">Mock mode</Badge>
                ) : (
                  <Badge tone="success">Live provider</Badge>
                )}{" "}
                <span className="text-fg-muted">
                  {s.mockMode.reason === "no_api_key"
                    ? "No API key is configured, so the deterministic mock provider answers."
                    : s.mockMode.reason === "forced_mock"
                      ? "Mock mode is forced by AI_MOCK_MODE."
                      : "Requests go to the configured provider."}
                </span>
              </TD>
            </TR>
            <TR>
              <TH scope="row">Provider API key</TH>
              <TD data-testid="api-key-status">{s.apiKey}</TD>
            </TR>
            <TR>
              <TH scope="row">Kill switch</TH>
              <TD>
                {s.killSwitch.active ? <Badge tone="danger">On</Badge> : <Badge>Off</Badge>}{" "}
                <span className="text-fg-muted">
                  Environment: {s.killSwitch.env ? "on" : "off"}. Admin switch:{" "}
                  {s.killSwitch.runtime ? "on" : "off"}.
                </span>
              </TD>
            </TR>
          </TBody>
        </Table>
      </Section>

      <Section
        title="Global kill switch"
        id="kill"
        meta="When on, Socra and practice AI refuse new requests. Editing, running code and submitting keep working. The AI_KILL_SWITCH environment variable always overrides this."
      >
        <Panel>
          <JsonForm
            url="/api/admin/ai?section=kill-switch"
            method="PUT"
            testId="kill-switch-form"
            hidden={{ enabled: !s.killSwitch.runtime }}
            submitLabel={s.killSwitch.runtime ? "Turn AI back on" : "Turn AI off for everyone"}
            variant={s.killSwitch.runtime ? "secondary" : "danger"}
            confirm={
              s.killSwitch.runtime
                ? "Re-enable AI for all courses?"
                : "Disable AI for all courses now?"
            }
            fields={[{ name: "reason", label: "Reason", required: true }]}
          />
        </Panel>
      </Section>

      <Section title="Models from the environment" id="env-models">
        <Table caption="Configured model tiers">
          <THead>
            <TR>
              <TH>Tier</TH>
              <TH>Model</TH>
            </TR>
          </THead>
          <TBody>
            {s.envModels.map((m) => (
              <TR key={m.tier}>
                <TD>{m.tier}</TD>
                <TD className="text-code font-mono">{m.model}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section
        title="Model configuration rows"
        id="models"
        meta="Per-task routing and price per million tokens, used for cost accounting. Saving a key that exists updates it."
      >
        {s.configs.length === 0 ? (
          <EmptyState>
            No rows. Models and prices come from the environment until you add one.
          </EmptyState>
        ) : (
          <Table caption="Model configurations">
            <THead>
              <TR>
                <TH>Key</TH>
                <TH>Provider</TH>
                <TH>Model</TH>
                <TH numeric>Input / 1M</TH>
                <TH numeric>Cached / 1M</TH>
                <TH numeric>Output / 1M</TH>
                <TH>Active</TH>
              </TR>
            </THead>
            <TBody>
              {s.configs.map((c) => (
                <TR key={c.id}>
                  <TD>{c.key}</TD>
                  <TD>{c.provider}</TD>
                  <TD className="text-code font-mono">{c.model}</TD>
                  <TD numeric>{c.inputPricePer1M}</TD>
                  <TD numeric>{c.cachedInputPricePer1M}</TD>
                  <TD numeric>{c.outputPricePer1M}</TD>
                  <TD>{c.isActive ? "Yes" : "No"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Add or update a model row
          </summary>
          <div className="mt-3">
            <JsonForm
              url="/api/admin/ai?section=model"
              method="PUT"
              submitLabel="Save model row"
              fields={[
                {
                  name: "key",
                  label: "Task or mode key",
                  required: true,
                  placeholder: "PROTECTED_ASSESSMENT",
                },
                { name: "model", label: "Model id", required: true },
                {
                  name: "provider",
                  label: "Provider",
                  type: "select",
                  defaultValue: "OPENAI",
                  options: [
                    { value: "OPENAI", label: "OpenAI" },
                    { value: "MOCK", label: "Mock" },
                  ],
                },
                {
                  name: "inputPricePer1M",
                  label: "Input price per 1M tokens (USD)",
                  type: "number",
                  step: "0.0001",
                  required: true,
                },
                {
                  name: "cachedInputPricePer1M",
                  label: "Cached input price per 1M (USD)",
                  type: "number",
                  step: "0.0001",
                  required: true,
                },
                {
                  name: "outputPricePer1M",
                  label: "Output price per 1M (USD)",
                  type: "number",
                  step: "0.0001",
                  required: true,
                },
                { name: "maxOutputTokens", label: "Max output tokens", type: "number" },
                { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
              ]}
            />
          </div>
        </details>
      </Section>

      <Section
        title="Course budgets"
        id="budgets"
        meta={`Defaults when no row exists: $${s.defaults.courseBudgetUsd} per course, alert at ${s.defaults.alertPct}%. Spend is the sum of cost on successful requests.`}
      >
        {s.courses.length === 0 ? (
          <EmptyState>No active courses.</EmptyState>
        ) : (
          <div className="space-y-3">
            {s.courses.map((c) => (
              <Panel
                key={c.courseId}
                titleAs="h3"
                title={c.code}
                meta={
                  c.budget
                    ? `Spent $${c.spentUsd.toFixed(2)} of $${c.budget.budgetUsd.toFixed(2)} (${
                        c.budget.budgetUsd > 0
                          ? Math.round((c.spentUsd / c.budget.budgetUsd) * 100)
                          : 0
                      }%)`
                    : `Spent $${c.spentUsd.toFixed(2)}. No budget row.`
                }
                actions={
                  c.budget?.aiDisabled ? <Badge tone="danger">AI disabled</Badge> : undefined
                }
              >
                <JsonForm
                  url="/api/admin/ai?section=budget"
                  method="PUT"
                  hidden={{ courseId: c.courseId }}
                  inline
                  testId={`budget-${c.courseId}`}
                  submitLabel="Save budget"
                  fields={[
                    {
                      name: "budgetUsd",
                      label: "Budget (USD)",
                      type: "number",
                      step: "0.01",
                      required: true,
                      defaultValue: c.budget?.budgetUsd ?? s.defaults.courseBudgetUsd,
                    },
                    {
                      name: "periodStart",
                      label: "Period start",
                      type: "date",
                      required: true,
                      defaultValue: dateInput(c.budget?.periodStart ?? defaultStart),
                    },
                    {
                      name: "periodEnd",
                      label: "Period end",
                      type: "date",
                      required: true,
                      defaultValue: dateInput(c.budget?.periodEnd ?? defaultEnd),
                    },
                    {
                      name: "alertThresholdPct",
                      label: "Alert at (%)",
                      type: "number",
                      defaultValue: c.budget?.alertThresholdPct ?? s.defaults.alertPct,
                    },
                    {
                      name: "hardStop",
                      label: "Refuse AI when exhausted",
                      type: "checkbox",
                      defaultValue: c.budget?.hardStop ?? true,
                    },
                    {
                      name: "aiDisabled",
                      label: "Disable AI for this course",
                      type: "checkbox",
                      defaultValue: c.budget?.aiDisabled ?? false,
                    },
                  ]}
                />
              </Panel>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
