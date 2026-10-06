import { LinkButton, MODE_COPY, PageHeader, TextLink } from "@/components/ui";

export const metadata = { title: "How Socra works" };

const LEVELS: Array<[string, string]> = [
  ["Orientation", "Restates what the question asks and where to start."],
  ["Socratic question", "Asks you something that points at the next step."],
  ["Conceptual hint", "Names the idea that applies, without applying it for you."],
  ["Diagnostic localization", "Points to the part of your code or reasoning where the problem is."],
  ["Related example", "Shows a different, smaller example or a course reading on the same idea."],
  ["Strong directional hint", "Says what to change, still without writing the protected answer."],
  ["Escalation", "Suggests you bring it to office hours or ask your TA."],
];

export default function HowSocraWorksPage() {
  return (
    <article className="max-w-[68ch]">
      <PageHeader title="How Socra works" meta="CSE 115 and CSE 116 pilot" />

      <div className="space-y-8 text-sm leading-6 text-fg">
        <section aria-labelledby="steps" className="space-y-3">
          <h2 id="steps" className="text-base font-semibold">
            Working through an assignment
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-fg-muted">
            <li>
              <span className="text-fg">Open the assignment and start.</span> You do not need to
              chat first. The prompt, starter code and public tests are in the workspace.
            </li>
            <li>
              <span className="text-fg">Ask Socra when you are stuck.</span> Socra can see the
              assignment prompt, your current code, and your latest run output, so you can ask
              “why does this test fail” without pasting anything.
            </li>
            <li>
              <span className="text-fg">Get help one level at a time.</span> Socra starts with a
              question or a small hint and only gets more specific if you still need it.
            </li>
            <li>
              <span className="text-fg">Submit your own work.</span> Hidden tests and your
              instructor grade it. Socra does not grade you.
            </li>
          </ol>
        </section>

        <section aria-labelledby="modes" className="space-y-3">
          <h2 id="modes" className="text-base font-semibold">
            Three modes
          </h2>
          <p className="text-fg-muted">
            The mode is shown at the top of the Socra panel. It depends on the activity, not on
            what you ask.
          </p>
          <dl className="space-y-3">
            {(["protected", "practice", "review"] as const).map((m) => (
              <div key={m}>
                <dt className="font-medium">{MODE_COPY[m].title}</dt>
                <dd className="text-fg-muted">{MODE_COPY[m].body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="levels" className="space-y-3">
          <h2 id="levels" className="text-base font-semibold">
            How specific the help gets
          </h2>
          <p className="text-fg-muted">
            On a protected assignment, Socra moves through these levels in order. Each assignment
            has a limit on how much help is available, and the panel shows how far along you are.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-fg-muted">
            {LEVELS.map(([name, desc]) => (
              <li key={name}>
                <span className="text-fg">{name}.</span> {desc}
              </li>
            ))}
          </ol>
          <p className="text-fg-muted">
            Syntax errors and error messages are a different case. Socra will explain a
            mechanical error directly, such as a missing colon or a misspelled name, because
            fixing it does not give away the problem.
          </p>
        </section>

        <section aria-labelledby="wont" className="space-y-3">
          <h2 id="wont" className="text-base font-semibold">
            What Socra will not do on a protected assignment
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-fg-muted">
            <li>Write the code or the written answer that the assignment asks you to produce.</li>
            <li>Tell you what the hidden tests check.</li>
            <li>Show the reference solution before the assignment closes and solutions are released.</li>
          </ul>
          <p className="text-fg-muted">
            If you ask for one of these, Socra says so and offers a different kind of help. Asking
            is not reported as misconduct.
          </p>
        </section>

        <section aria-labelledby="profile" className="space-y-3">
          <h2 id="profile" className="text-base font-semibold">
            Your learning profile
          </h2>
          <p className="text-fg-muted">
            Socra groups your graded work and practice answers by topic and shows one of three
            states: Needs reinforcement, Developing, or Consistently demonstrated. These describe
            recent evidence and change as you keep working. They are not grades. In this pilot, class
            analytics are anonymous and aggregate, so your instructor does not see your topic
            states by name.
          </p>
        </section>

        <section aria-labelledby="data" className="space-y-3">
          <h2 id="data" className="text-base font-semibold">
            {"How learning signals are used"}
          </h2>
          <p className="text-fg-muted">
            Socra may use assignment performance, attempts, hint usage, and concept-level patterns
            to help you understand what to practice. Instructors see course learning patterns. Your
            raw Socra conversations are not shown in ordinary faculty analytics. The{" "}
            <TextLink href="/privacy">privacy page</TextLink> lists exactly what is collected and
            who can see it.
          </p>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-6">
          <LinkButton href="/home" variant="primary">
            Go to your assignments
          </LinkButton>
          <LinkButton href="/privacy">Read the privacy details</LinkButton>
        </div>
      </div>
    </article>
  );
}
