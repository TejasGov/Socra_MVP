import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { activeMembership, assertCan } from "@/server/auth/rbac";
import { rateLimit } from "@/server/auth/rate-limit";
import { assertSameOrigin, errorResponse, HttpError, json, parseJson, route } from "@/server/http";
import { testCaseToSpec } from "@/server/domain/assignments/test-mapping";
import { visibleToStudents } from "@/server/domain/assignments/state-machine";
import { recordCodeRun } from "@/server/domain/workspace/runs";
import { executeRun } from "@/server/runner/service";
import { scrubHarnessOutput, toStudentRunResult } from "@/server/runner/types";

export const dynamic = "force-dynamic";

const MAX_CODE_CHARS = 100_000;
const MAX_STDIN_CHARS = 64_000;
const RUNS_PER_MINUTE = 30;

const bodySchema = z.object({
  assignmentId: z.string().min(1),
  questionId: z.string().min(1),
  code: z.string().max(MAX_CODE_CHARS),
  stdin: z.string().max(MAX_STDIN_CHARS).optional(),
  kind: z.enum(["RUN", "PUBLIC_TESTS"]),
  draftVersion: z.number().int().min(0).optional(),
});

/** POST /api/runs — run code or the question's PUBLIC tests in the sandbox; returns the student-safe result. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseJson(req, bodySchema);
  const user = await requireUser();

  const question = await prisma.question.findFirst({
    where: { id: input.questionId, assignmentId: input.assignmentId },
    select: {
      assignment: { select: { courseId: true, state: true, language: true } },
      currentVersion: {
        select: {
          language: true,
          entryPoint: true,
          testCases: {
            where: { visibility: "PUBLIC" },
            orderBy: { order: "asc" },
            select: {
              id: true,
              name: true,
              visibility: true,
              weight: true,
              input: true,
              expected: true,
              harness: true,
              timeoutMs: true,
              failureHint: true,
            },
          },
        },
      },
    },
  });
  if (!question) throw new HttpError(404, "question_not_found", "Question not found");
  const { courseId, state } = question.assignment;
  assertCan(user, "code:run", { courseId });
  const membership = activeMembership(user, courseId);
  if (membership?.role === "STUDENT" && !visibleToStudents(state)) {
    throw new HttpError(404, "assignment_not_found", "Assignment not found");
  }
  const language = question.currentVersion?.language ?? question.assignment.language;
  if (!language)
    throw new HttpError(400, "no_language", "This question has no programming language");

  const rl = await rateLimit(`runs:${user.id}`, RUNS_PER_MINUTE, 60_000);
  if (!rl.allowed) {
    const res = errorResponse(429, "rate_limited", "Too many runs. Wait a moment and try again.");
    res.headers.set("retry-after", String(Math.ceil(rl.resetMs / 1000)));
    return res;
  }

  // Only PUBLIC tests are ever loaded here; hidden tests are run by the grading pipeline.
  const tests =
    input.kind === "PUBLIC_TESTS"
      ? (question.currentVersion?.testCases ?? []).map((t) =>
          testCaseToSpec(t, question.currentVersion?.entryPoint),
        )
      : [];
  if (input.kind === "PUBLIC_TESTS" && tests.length === 0) {
    throw new HttpError(400, "no_public_tests", "This question has no public tests");
  }

  const runId = randomUUID();
  // Scrub harness frames before storing, so Socra's view of the latest run is clean too.
  const result = scrubHarnessOutput(
    await executeRun({
      runId,
      language,
      code: input.code,
      stdin: input.stdin,
      tests,
      kind: input.kind,
    }),
  );
  await recordCodeRun(
    user,
    {
      runId,
      assignmentId: input.assignmentId,
      questionId: input.questionId,
      code: input.code,
      stdin: input.stdin,
      kind: input.kind,
      draftVersion: input.draftVersion,
    },
    result,
  );
  return json(toStudentRunResult(result));
});

// Vercel function limit: sandbox create + run + stop can exceed the default for multi-test runs.
export const maxDuration = 60;
