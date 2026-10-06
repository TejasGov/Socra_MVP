import { Badge, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getFlagMatrix } from "@/server/domain/admin/flags";
import { FlagSelect } from "../../_components/flag-select";

export const metadata = { title: "Feature flags" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL = {
  course: "course override",
  environment_override: "environment override",
  env_default: "env default",
} as const;

export default async function Page() {
  const user = await requirePageUser("/admin/flags");
  const { courses, flags } = await getFlagMatrix(user);
  return (
    <div className="max-w-full">
      <PageHeader
        title="Feature flags"
        meta="A course override wins over the environment override, which wins over the env default. Changes apply on the next request and are audited."
      />
      {courses.length === 0 ? (
        <EmptyState>No active courses. Environment-wide settings are still available.</EmptyState>
      ) : null}
      <Table caption="Feature flags by scope">
        <THead>
          <TR>
            <TH>Flag</TH>
            <TH>Env default</TH>
            <TH>Environment override</TH>
            {courses.map((c) => (
              <TH key={c.id}>{c.code}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {flags.map((f) => (
            <TR key={f.key} data-testid={`flag-row-${f.key}`}>
              <TD>
                <div className="font-medium">{f.key}</div>
                <div className="text-fg-muted text-xs">{f.description}</div>
              </TD>
              <TD>{f.envDefault ? "On" : "Off"}</TD>
              <TD>
                <FlagSelect
                  flagKey={f.key}
                  value={f.environmentOverride}
                  label={`${f.key}, environment override`}
                />
                <div className="text-fg-muted mt-1 text-xs">
                  Effective:{" "}
                  <Badge tone={f.effective ? "success" : "neutral"}>
                    {f.effective ? "On" : "Off"}
                  </Badge>
                </div>
              </TD>
              {f.courses.map((c) => (
                <TD key={c.courseId}>
                  <FlagSelect
                    flagKey={f.key}
                    courseId={c.courseId}
                    value={c.override}
                    label={`${f.key}, ${courses.find((x) => x.id === c.courseId)?.code ?? "course"} override`}
                  />
                  <div className="text-fg-muted mt-1 text-xs">
                    Effective:{" "}
                    <Badge tone={c.effective ? "success" : "neutral"}>
                      {c.effective ? "On" : "Off"}
                    </Badge>
                    <div>{SOURCE_LABEL[c.source]}</div>
                  </div>
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
