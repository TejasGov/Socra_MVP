import Link from "next/link";
import { PageHeader, Table, TBody, TD, TH, THead, TR, DateText } from "@/components/ui";
import { PracticeStart, type PracticeCourseDto } from "@/components/practice/practice-start";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { listCoursesForUser } from "@/server/domain/assignments/queries";
import { getPracticeTopics } from "@/server/domain/practice";

export const metadata = { title: "Practice" };
export const dynamic = "force-dynamic";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string; topicId?: string }>;
}) {
  const sp = await searchParams;
  const user = await requirePageUser("/practice");
  const courses = (await listCoursesForUser(user)).filter((c) => c.role === "STUDENT");

  const withTopics: PracticeCourseDto[] = await Promise.all(
    courses.map(async (c) => {
      try {
        const topics = await getPracticeTopics(user, c.id);
        return { id: c.id, code: c.code, title: c.title, topics, topicsError: null };
      } catch {
        return {
          id: c.id,
          code: c.code,
          title: c.title,
          topics: [],
          topicsError:
            "Topics for this course could not be loaded. You can still start a mixed session.",
        };
      }
    }),
  );

  const recent = await prisma.practiceSession.findMany({
    where: { userId: user.id },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      startedAt: true,
      itemsServed: true,
      correctCount: true,
      course: { select: { code: true } },
      topic: { select: { name: true } },
    },
  });

  return (
    <div className="max-w-[1000px]">
      <PageHeader
        title="Practice"
        meta="Questions adapt to your answers. Practice does not affect assignment grades."
      />
      <PracticeStart
        courses={withTopics}
        initialCourseId={sp.courseId ?? null}
        initialTopicId={sp.topicId ?? null}
      />
      {recent.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-fg mb-3 text-base font-semibold">Recent practice sessions</h2>
          <Table>
            <THead>
              <TR>
                <TH>Course</TH>
                <TH>Topic</TH>
                <TH>Started</TH>
                <TH numeric>Correct</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {recent.map((s) => (
                <TR key={s.id}>
                  <TD>{s.course.code}</TD>
                  <TD>{s.topic?.name ?? "Mixed topics"}</TD>
                  <TD>
                    <DateText date={s.startedAt} />
                  </TD>
                  <TD numeric>
                    {s.correctCount} of {s.itemsServed}
                  </TD>
                  <TD>
                    <Link
                      href={`/practice/${s.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      {s.status === "ACTIVE" ? "Continue session" : "View summary"}
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}
