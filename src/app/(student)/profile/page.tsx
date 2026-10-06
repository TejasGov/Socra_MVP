import {
  DateText,
  EmptyState,
  PageHeader,
  TabLinks,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TextLink,
  StateBadge,
} from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { getLearnerProfile, type LearnerProfileTopic } from "@/server/domain/learner";
import { practiceHref, studentCourses } from "../_lib/student-data";

export const metadata = { title: "Learning profile" };

const TRAJECTORY: Record<LearnerProfileTopic["trajectory"], string> = {
  IMPROVING: "Improving",
  STABLE: "Steady",
  NEEDS_ATTENTION: "Recent work was harder",
};

const CONFIDENCE: Record<LearnerProfileTopic["confidence"], string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const { courseId } = await searchParams;
  const user = await requirePageUser("/profile");
  const courses = await studentCourses(user);

  if (courses.length === 0) {
    return (
      <>
        <PageHeader title="Learning profile" />
        <EmptyState>
          You are not enrolled as a student in any pilot course, so there is no learning profile yet.
        </EmptyState>
      </>
    );
  }

  const course = courses.find((c) => c.id === courseId) ?? courses[0]!;
  const profile = await getLearnerProfile(user.id, course.id);

  return (
    <>
      <PageHeader title="Learning profile" meta={`${course.code} ${course.title} · ${course.term}`} />

      {courses.length > 1 ? (
        <TabLinks
          label="Course"
          className="mb-6"
          items={courses.map((c) => ({
            href: `/profile?courseId=${c.id}`,
            label: c.code,
            active: c.id === course.id,
          }))}
        />
      ) : null}

      <div className="mb-6 max-w-[68ch] space-y-2 text-sm text-fg-muted">
        <p>
          Each topic shows what your recent work in {course.code} suggests, not a fixed ability. A
          state moves as you submit assignments and answer practice questions. Topics with no
          evidence yet are not listed.
        </p>
        <p>
          <span className="font-medium text-fg">Evidence</span> counts the graded answers, practice
          answers and Socra-assisted steps used for the topic.{" "}
          <span className="font-medium text-fg">Confidence</span> says how much evidence there is,
          not how well you did.
        </p>
      </div>

      {profile.topics.length === 0 ? (
        <EmptyState
          action={<TextLink href={practiceHref(course.id)}>Start a practice set</TextLink>}
        >
          No topic evidence in {course.code} yet. Topics appear after your first graded submission or
          practice answers.
        </EmptyState>
      ) : (
        <Table caption={`Learning profile topics for ${course.code}`}>
          <THead>
            <tr>
              <TH>Topic</TH>
              <TH>State</TH>
              <TH>Last 14 days</TH>
              <TH numeric>Evidence</TH>
              <TH>Confidence</TH>
              <TH>Last demonstrated</TH>
              <TH>Next step</TH>
            </tr>
          </THead>
          <TBody>
            {profile.topics.map((t) => {
              const tr = TRAJECTORY[t.trajectory];
              return (
                <TR key={t.topicId} data-testid="profile-topic-row" data-state={t.state}>
                  <th scope="row" className="min-w-52 px-3 py-2 text-left align-middle font-medium text-fg">
                    {t.name}
                    {t.commonDifficulty ? (
                      <span className="block text-xs font-normal text-fg-subtle">
                        Common difficulty: {t.commonDifficulty}
                      </span>
                    ) : null}
                  </th>
                  <TD>
                    <StateBadge state={t.state} />
                  </TD>
                  <TD className="text-fg-muted">
                    <span title="Compared with the 14 days before">{tr}</span>
                  </TD>
                  <TD numeric>{t.evidenceCount}</TD>
                  <TD className="text-fg-muted">{CONFIDENCE[t.confidence]}</TD>
                  <TD className="text-fg-muted">
                    {t.lastDemonstratedAt ? <DateText date={t.lastDemonstratedAt} /> : "Not yet"}
                  </TD>
                  <TD className="min-w-64">
                    <span className="block text-fg-muted">{t.suggestedAction}</span>
                    <TextLink href={practiceHref(course.id, t.topicId)} className="text-xs">
                      Practice<span className="sr-only"> {t.name}</span>
                    </TextLink>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
