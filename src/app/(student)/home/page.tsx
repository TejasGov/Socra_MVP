import Link from "next/link";
import {
  DateText,
  EmptyState,
  LinkButton,
  PageHeader,
  Section,
  StateBadge,
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
import { DueCell, ModeCell, StatusCell } from "../_lib/assignment-bits";
import {
  allAssignments,
  assignmentHref,
  practiceHref,
  recentSocraSessions,
  studentCourses,
} from "../_lib/student-data";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requirePageUser("/home");
  const courses = await studentCourses(user);

  if (courses.length === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <EmptyState>
          You are not enrolled as a student in any pilot course. If you expected to see CSE 115 or
          CSE 116, ask your instructor to add you to the roster.
        </EmptyState>
      </>
    );
  }

  const [assignments, sessions, profiles] = await Promise.all([
    allAssignments(user, courses),
    recentSocraSessions(user),
    Promise.all(courses.map((c) => getLearnerProfile(user.id, c.id).then((p) => ({ course: c, p })))),
  ]);

  const open = assignments.filter(
    (a) => !a.isClosed && (a.progressStatus === "NOT_STARTED" || a.progressStatus === "IN_PROGRESS"),
  );
  const upcoming = [...open]
    .sort((x, y) => (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity))
    .slice(0, 6);
  const inProgress = assignments.filter((a) => a.progressStatus === "IN_PROGRESS" && !a.isClosed);
  const feedback = assignments.filter((a) => a.progressStatus === "RETURNED");

  const reinforce = profiles.flatMap(({ course, p }) =>
    p.topics
      .filter((t) => t.state === "NEEDS_REINFORCEMENT")
      .map((t) => ({ ...t, courseId: course.id, courseCode: course.code })),
  );
  const suggestion = reinforce[0];
  const term = courses[0]?.term;

  return (
    <>
      <PageHeader
        title="Home"
        meta={`${courses.map((c) => c.code).join(" · ")}${term ? ` · ${term}` : ""}`}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <Section id="upcoming" title="Due next" meta="Open assignments you have not submitted, soonest first.">
            {upcoming.length === 0 ? (
              <EmptyState>Nothing is due. New assignments appear here when your instructor publishes them.</EmptyState>
            ) : (
              <Table caption="Open assignments, soonest due first">
                <THead>
                  <tr>
                    <TH>Assignment</TH>
                    <TH>Course</TH>
                    <TH>Due</TH>
                    <TH>Status</TH>
                    <TH>Socra</TH>
                  </tr>
                </THead>
                <TBody>
                  {upcoming.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link href={assignmentHref(a)} className="font-medium text-fg hover:text-accent hover:underline">
                          {a.title}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap text-fg-muted">{a.courseCode}</TD>
                      <TD>
                        <DueCell a={a} />
                      </TD>
                      <TD>
                        <StatusCell a={a} />
                      </TD>
                      <TD>
                        <ModeCell a={a} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>

          <Section id="continue" title="Continue where you left off">
            {inProgress.length === 0 && feedback.length === 0 ? (
              <EmptyState>
                Assignments you have opened but not submitted will be listed here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {inProgress.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{a.title}</p>
                      <p className="text-xs text-fg-subtle">
                        {a.courseCode} · In progress
                        {a.dueAt ? <> · due <DueCell a={a} /></> : null}
                      </p>
                    </div>
                    <LinkButton href={assignmentHref(a)} size="sm">
                      Open workspace
                    </LinkButton>
                  </li>
                ))}
                {feedback.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{a.title}</p>
                      <p className="text-xs text-fg-subtle">{a.courseCode} · Feedback available</p>
                    </div>
                    <LinkButton href={assignmentHref(a)} size="sm">
                      Read feedback
                    </LinkButton>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="sessions"
            title="Recent Socra sessions"
            actions={<TextLink href="/history" className="text-sm">View history</TextLink>}
          >
            {sessions.length === 0 ? (
              <EmptyState>
                No Socra sessions yet. When you ask Socra for help inside an assignment or practice
                set, the session is listed here.
              </EmptyState>
            ) : (
              <Table caption="Recent Socra sessions">
                <THead>
                  <tr>
                    <TH>Session</TH>
                    <TH>Type</TH>
                    <TH>Course</TH>
                    <TH>Last activity</TH>
                  </tr>
                </THead>
                <TBody>
                  {sessions.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        {s.href ? (
                          <Link href={s.href} className="text-fg hover:text-accent hover:underline">
                            {s.title}
                          </Link>
                        ) : (
                          s.title
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-fg-muted">{s.kind}</TD>
                      <TD className="whitespace-nowrap text-fg-muted">{s.courseCode}</TD>
                      <TD className="text-fg-muted">
                        <DateText date={s.lastActivityAt} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
        </div>

        <aside className="space-y-8" aria-label="Practice and reinforcement">
          <Section id="practice-suggestion" title="Suggested practice">
            {suggestion ? (
              <div className="space-y-2 text-sm">
                <p className="text-fg-muted">
                  {suggestion.name} ({suggestion.courseCode}) needs reinforcement, based on{" "}
                  {suggestion.evidenceCount} piece{suggestion.evidenceCount === 1 ? "" : "s"} of evidence.
                </p>
                <LinkButton href={practiceHref(suggestion.courseId, suggestion.topicId)} variant="primary">
                  Practice {suggestion.name}
                </LinkButton>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-fg-muted">
                  Practice sets are ungraded. Socra can explain answers fully while you practice.
                </p>
                <LinkButton href="/practice">Choose a practice topic</LinkButton>
              </div>
            )}
          </Section>

          <Section
            id="reinforce"
            title="Topics to reinforce"
            meta="From your graded work and practice. States change as you do more work."
          >
            {reinforce.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No topics need reinforcement right now. Topics appear once there is enough evidence
                from your work.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {reinforce.slice(0, 5).map((t) => (
                  <li key={`${t.courseId}:${t.topicId}`} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-fg">{t.name}</span>
                      <TextLink href={practiceHref(t.courseId, t.topicId)} className="shrink-0 text-xs">
                        Practice
                      </TextLink>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
                      <StateBadge state={t.state} />
                      <span>{t.courseCode}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <TextLink href="/profile" className="text-sm">
              Open learning profile
            </TextLink>
          </Section>
        </aside>
      </div>
    </>
  );
}
