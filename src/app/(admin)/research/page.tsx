import Link from "next/link";
import {
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
import { getResearchOverview } from "@/server/domain/research/overview";

export const metadata = { title: "Research" };
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

export default async function Page() {
  const user = await requirePageUser("/research");
  const o = await getResearchOverview(user);
  const total = o.byCondition.reduce((n, c) => n + c.count, 0);
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader
        title="Research"
        meta="Participants are shown by pseudonymous id only. Raw conversations need a separate, audited grant."
      />
      {total === 0 ? (
        <EmptyState
          action={
            <Link className="text-accent underline" href="/research/participants">
              Go to participants
            </Link>
          }
        >
          No participants are enrolled yet.
        </EmptyState>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Participants by condition" id="conditions">
            <Table caption="Participants by condition">
              <THead>
                <TR>
                  <TH>Condition</TH>
                  <TH numeric>Participants</TH>
                </TR>
              </THead>
              <TBody>
                {o.byCondition.map((c) => (
                  <TR key={c.condition}>
                    <TD>{CONDITION_LABEL[c.condition] ?? c.condition}</TD>
                    <TD numeric>{c.count}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="Consent status" id="consent">
            <Table caption="Participants by consent status">
              <THead>
                <TR>
                  <TH>Status</TH>
                  <TH numeric>Participants</TH>
                </TR>
              </THead>
              <TBody>
                {o.byConsent.map((c) => (
                  <TR key={c.consent}>
                    <TD>{CONSENT_LABEL[c.consent] ?? c.consent}</TD>
                    <TD numeric>{c.count}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>
      )}
      <Section title="Data" id="data">
        <ul className="space-y-1 text-sm">
          <li>
            Events stamped with a study condition:{" "}
            <span className="tabular-nums">{o.conditionStampedEvents}</span>
          </li>
          <li>
            Exports completed:{" "}
            <span className="tabular-nums">
              {o.exportsByStatus.find((e) => e.status === "COMPLETED")?.count ?? 0}
            </span>
            {o.lastExport?.completedAt ? (
              <>
                , last <DateText date={o.lastExport.completedAt} /> ({o.lastExport.rowCount} rows)
              </>
            ) : null}
          </li>
        </ul>
        <p className="mt-3 text-sm">
          <Link className="text-accent underline" href="/research/participants">
            Participants and conditions
          </Link>
          {" · "}
          <Link className="text-accent underline" href="/research/exports">
            Exports
          </Link>
        </p>
      </Section>
    </div>
  );
}
