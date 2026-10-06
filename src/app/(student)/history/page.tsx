import Link from "next/link";
import {
  Badge,
  DateText,
  EmptyState,
  LinkButton,
  PageHeader,
  Section,
  TabLinks,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TextLink,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getLearnerProfile } from "@/server/domain/learner";
import { recentSocraSessions, studentCourses } from "../_lib/student-data";

export const metadata = { title: "History" };

type Kind = "all" | "assignment" | "practice";
const KINDS: Array<{ id: Kind; label: string }> = [
  { id: "all", label: "All sessions" },
  { id: "assignment", label: "Assignments" },
  { id: "practice", label: "Practice" },
];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: rawKind } = await searchParams;
  const kind: Kind = rawKind === "assignment" || rawKind === "practice" ? rawKind : "all";
  const user = await requirePageUser("/history");
  const [sessions, courses] = await Promise.all([
    recentSocraSessions(user, 50, kind),
    studentCourses(user),
  ]);
  const profiles = await Promise.all(courses.map((c) => getLearnerProfile(user.id, c.id)));
  const topics = profiles.flatMap((p) => p.topics);
  const count = (s: string) => topics.filter((t) => t.state === s).length;

  return (
    <>
      <PageHeader title="History" meta="Your Socra sessions, most recent first. Last 50 shown." />

      <TabLinks
        label="Session type"
        className="mb-4"
        items={KINDS.map((k) => ({
          href: k.id === "all" ? "/history" : `/history?kind=${k.id}`,
          label: k.label,
          active: k.id === kind,
        }))}
      />

      <div className="space-y-8">
        {sessions.length === 0 ? (
          <EmptyState action={<LinkButton href="/home">Go to Home</LinkButton>}>
            No sessions here yet. When you ask Socra for help in an assignment or a practice set,
            the session is listed here.
          </EmptyState>
        ) : (
          <Table caption="Socra sessions">
            <THead>
              <tr>
                <TH>Session</TH>
                <TH>Type</TH>
                <TH>Course</TH>
                <TH>Status</TH>
                <TH>Started</TH>
                <TH>Last activity</TH>
                <TH>
                  <span className="sr-only">Action</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {sessions.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.title}</TD>
                  <TD className="whitespace-nowrap text-fg-muted">{s.kind}</TD>
                  <TD className="whitespace-nowrap text-fg-muted">{s.courseCode}</TD>
                  <TD>
                    <Badge>{s.status}</Badge>
                  </TD>
                  <TD className="text-fg-muted">
                    <DateText date={s.startedAt} />
                  </TD>
                  <TD className="text-fg-muted">
                    <DateText date={s.lastActivityAt} />
                  </TD>
                  <TD className="text-right">
                    {s.href ? (
                      <Link href={s.href} className="text-accent hover:underline">
                        {s.status === "In progress" ? "Continue session" : "Review session"}
                        <span className="sr-only"> {s.title}</span>
                      </Link>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Section id="patterns" title="Topic summary" meta="Across your courses, from graded work and practice.">
          {topics.length === 0 ? (
            <p className="text-sm text-fg-muted">No topic evidence yet.</p>
          ) : (
            <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">Needs reinforcement</dt>
                <dd className="font-semibold tabular-nums">{count("NEEDS_REINFORCEMENT")} topics</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Developing</dt>
                <dd className="font-semibold tabular-nums">{count("DEVELOPING")} topics</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Consistently demonstrated</dt>
                <dd className="font-semibold tabular-nums">{count("CONSISTENTLY_DEMONSTRATED")} topics</dd>
              </div>
            </dl>
          )}
          <TextLink href="/profile" className="text-sm">
            Open learning profile
          </TextLink>
        </Section>
      </div>
    </>
  );
}
