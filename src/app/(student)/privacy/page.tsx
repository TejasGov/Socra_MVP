import { PageHeader, TBody, TD, TH, THead, TR, Table, TextLink } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

export const metadata = { title: "Privacy" };

const RETENTION_LABELS: Record<string, string> = {
  IDENTITY: "Account details",
  EDUCATIONAL_RECORD: "Submissions and grades",
  SENSITIVE_CONVERSATION: "Socra conversations (message text)",
  AI_REQUEST_LOG: "AI request logs (usage, cost, errors)",
  LEARNING_EVIDENCE: "Learning evidence behind your profile",
  AGGREGATE: "Class-level aggregates",
  RESEARCH: "Research dataset (pseudonymous)",
  SECURITY_AUDIT: "Security audit log",
  TRAINING: "Reviewed examples for improving Socra",
  OPERATIONAL: "Operational records (sign-in sessions, jobs)",
};

/**
 * TRIVIAL READ (Agent F; RetentionPolicy is owned by the admin domain): the configured retention
 * schedule, shown to students as required by PRD §26.4.
 */
async function retentionSchedule() {
  return prisma.retentionPolicy.findMany({
    select: { category: true, retentionDays: true, action: true },
    orderBy: { category: "asc" },
  });
}

function describeRetention(days: number | null, action: string): string {
  if (!days || action === "KEEP") return "Not yet scheduled for automatic removal";
  const verb =
    action === "DEIDENTIFY" ? "De-identified" : action === "DELETE" ? "Deleted" : "Archived";
  return `${verb} after ${days} days`;
}

export default async function PrivacyPage() {
  const user = await requirePageUser("/privacy");
  const policies = await retentionSchedule();
  const minN = env().ANALYTICS_SMALL_N_THRESHOLD;

  return (
    <article>
      <PageHeader title="Privacy" meta={`Signed in as ${user.email}`} />

      <div className="max-w-[68ch] space-y-8 text-sm leading-6 text-fg">
        <section aria-labelledby="access" className="space-y-2">
          <h2 id="access" className="text-base font-semibold">
            What Socra can read while helping you
          </h2>
          <p className="text-fg-muted">Depending on where you open it, Socra can read:</p>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">
            <li>the assignment prompt and public tests,</li>
            <li>your current code or written answer,</li>
            <li>the output of your latest run,</li>
            <li>your earlier messages in the same Socra session,</li>
            <li>course materials your instructor uploaded for that assignment.</li>
          </ul>
          <p className="text-fg-muted">
            It cannot read your other courses, your email, or files you have not opened in Socra.
            Hidden tests and reference solutions are not sent to the model while an assignment is
            protected.
          </p>
        </section>

        <section aria-labelledby="collect" className="space-y-2">
          <h2 id="collect" className="text-base font-semibold">
            What is recorded
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">
            <li>whether answers and tests were correct, and how many attempts you made,</li>
            <li>how many hints you asked for and how specific the help became,</li>
            <li>when you opened, ran and submitted work (timestamps, not keystrokes),</li>
            <li>topic and common-mistake signals inferred from your work,</li>
            <li>practice answers and outcomes,</li>
            <li>the text of your Socra conversations.</li>
          </ul>
          <p className="text-fg-muted">
            This is used to run the course (saving work, grading), to suggest what to practice, to
            show instructors where the class is stuck, and for the approved pilot study.
          </p>
        </section>

        <section aria-labelledby="faculty" className="space-y-2">
          <h2 id="faculty" className="text-base font-semibold">
            What your instructor and TAs can see
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">
            <li>Your submissions and grades, as in any course tool.</li>
            <li>
              Class-level patterns: which questions and topics the class found hard, and how much
              help was used. Any group smaller than {minN} students is hidden.
            </li>
            <li>
              Not your Socra conversations. Raw conversation text is not part of faculty analytics.
            </li>
          </ul>
          <p className="text-fg-muted">
            Raw conversations can be opened only by a small number of research or system
            administrators, for a stated reason, and every access is written to an audit log.
          </p>
        </section>

        <section aria-labelledby="research" className="space-y-2">
          <h2 id="research" className="text-base font-semibold">
            Research use
          </h2>
          <p className="text-fg-muted">
            Socra is part of a research pilot. Research exports use a pseudonym instead of your
            name or email, and only include students who consented under the approved study
            protocol. Declining does not change how Socra helps you or how you are graded. Ask
            your instructor for the study information sheet or to change your choice.
          </p>
        </section>

        <section aria-labelledby="provider" className="space-y-2">
          <h2 id="provider" className="text-base font-semibold">
            The model provider
          </h2>
          <p className="text-fg-muted">
            Socra sends the context listed above to the OpenAI API to write its replies. The
            pilot does not opt in to the provider using this data for training. Socra keeps its
            own copy of the conversation under the schedule below rather than relying on the
            provider to store it.
          </p>
        </section>

        <section aria-labelledby="retention" className="space-y-3">
          <h2 id="retention" className="text-base font-semibold">
            How long data is kept
          </h2>
          {policies.length === 0 ? (
            <p className="text-fg-muted">
              The retention schedule has not been configured in this environment yet.
            </p>
          ) : (
            <Table caption="Retention schedule">
              <THead>
                <tr>
                  <TH>Data</TH>
                  <TH>Retention</TH>
                </tr>
              </THead>
              <TBody>
                {policies.map((p) => (
                  <TR key={p.category}>
                    <TD>{RETENTION_LABELS[p.category] ?? p.category}</TD>
                    <TD className="text-fg-muted">{describeRetention(p.retentionDays, p.action)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <section aria-labelledby="rights" className="space-y-2">
          <h2 id="rights" className="text-base font-semibold">
            Corrections and questions
          </h2>
          <p className="text-fg-muted">
            If something in your learning profile looks wrong, tell your instructor. Profiles are
            recomputed from the underlying evidence, so a corrected grade or record updates the
            topic states. Your education records are covered by UB&apos;s FERPA policy. See also{" "}
            <TextLink href="/how-socra-works">How Socra works</TextLink>.
          </p>
        </section>
      </div>
    </article>
  );
}
