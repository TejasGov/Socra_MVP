import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../../../src/generated/prisma/client";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Playwright global teardown: archive every assignment the suite created (title starts with "E2E")
 * so test fixtures never show up in student, faculty or analytics views of the dev database.
 * ARCHIVED assignments are excluded from those lists by default.
 */
export default async function globalTeardown(): Promise<number> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 0;
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") ?? undefined;
  url.searchParams.delete("schema");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }),
  });
  try {
    const res = await prisma.assignment.updateMany({
      where: { title: { startsWith: "E2E" }, state: { not: "ARCHIVED" } },
      data: { state: "ARCHIVED", archivedAt: new Date() },
    });
    if (res.count > 0) console.log(`E2E teardown: archived ${res.count} E2E assignment(s).`);
    // Reset the dedicated E2E students (28-30) so reruns always have attempts. Submission cascades
    // to SubmissionAnswer/Grade/GradeOverrideAudit; CodeRun.submissionId is SetNull. Append-only
    // tables (AnalyticsEvent, LearningEvidence, AuditLog, HeldOutEvalItem) are never touched.
    const e2eStudents = {
      email: { in: ["student28", "student29", "student30"].map((s) => `${s}@socra.local`) },
    };
    const courses = { course: { code: { in: ["CSE 115", "CSE 116"] } } };
    const subs = await prisma.submission.deleteMany({
      where: { user: e2eStudents, assignment: courses },
    });
    const drafts = await prisma.draft.deleteMany({
      where: { user: e2eStudents, assignment: courses },
    });
    await prisma.assignmentProgress.updateMany({
      where: { user: e2eStudents, assignment: courses },
      data: {
        attemptsUsed: 0,
        latestSubmissionId: null,
        submittedAt: null,
        returnedAt: null,
        status: "NOT_STARTED",
      },
    });
    if (subs.count + drafts.count > 0) {
      console.log(
        `E2E teardown: removed ${subs.count} submission(s) and ${drafts.count} draft(s) for student28-30.`,
      );
    }
    return res.count;
  } finally {
    await prisma.$disconnect();
  }
}
