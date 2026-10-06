import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PracticeSession, type PracticeSummaryDto } from "@/components/practice/practice-session";
import { requirePageUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { completePracticeSession } from "@/server/domain/practice";

export const metadata = { title: "Practice session" };
export const dynamic = "force-dynamic";

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requirePageUser(`/practice/${sessionId}`);
  const session = await prisma.practiceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      status: true,
      course: { select: { code: true, title: true } },
      topic: { select: { name: true } },
    },
  });
  if (!session || session.userId !== user.id) notFound();

  // Completed sessions show their summary (computed from stored attempts; no state change).
  const summary: PracticeSummaryDto | null =
    session.status === "ACTIVE" ? null : await completePracticeSession(user, sessionId);

  return (
    <div data-shell-width="full" className="mx-auto max-w-[1440px]">
      <PageHeader
        title={`Practice: ${session.topic?.name ?? "mixed topics"}`}
        meta={`${session.course.code} · ${session.course.title}`}
        back={{ href: "/practice", label: "Practice" }}
      />
      <PracticeSession
        sessionId={session.id}
        courseId={session.courseId}
        courseCode={session.course.code}
        initialSummary={summary}
      />
    </div>
  );
}
