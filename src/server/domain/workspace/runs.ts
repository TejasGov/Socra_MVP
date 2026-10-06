import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CodeRunStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";
import { activeMembership, assertCan } from "@/server/auth/rbac";
import { writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";
import type { RunResult } from "@/server/runner/types";
import { sha256 } from "@/server/domain/assignments/test-mapping";
import { visibleToStudents } from "@/server/domain/assignments/state-machine";

export interface RecordCodeRunInput {
  /** Defaults to result.runId. */
  runId?: string;
  assignmentId: string;
  questionId: string;
  code: string;
  stdin?: string;
  kind: "RUN" | "PUBLIC_TESTS";
  draftVersion?: number;
}

/**
 * Persist a CodeRun (execution snapshot) and emit code_run_requested/code_run_completed in one transaction.
 * Stores PUBLIC test results only. Staff previews are not stored as student data.
 * Idempotent on runId (the CodeRun row may already exist, queued by the runner service).
 */
export async function recordCodeRun(
  user: CurrentUser,
  input: RecordCodeRunInput,
  result: RunResult,
): Promise<{ codeRunId: string; stored: boolean }> {
  const runId = input.runId ?? result.runId;
  const a = await prisma.assignment.findUnique({
    where: { id: input.assignmentId },
    select: {
      courseId: true,
      state: true,
      language: true,
      currentVersion: { select: { version: true } },
      questions: {
        where: { id: input.questionId },
        select: { currentVersion: { select: { version: true, language: true } } },
      },
    },
  });
  if (!a || a.questions.length === 0)
    throw new HttpError(404, "question_not_found", "Question not found");
  assertCan(user, "code:run", { courseId: a.courseId });
  const membership = activeMembership(user, a.courseId);
  if (membership?.role !== "STUDENT") return { codeRunId: runId, stored: false };
  if (!visibleToStudents(a.state))
    throw new HttpError(404, "assignment_not_found", "Assignment not found");

  const qv = a.questions[0]!.currentVersion;
  const language = qv?.language ?? a.language;
  if (!language)
    throw new HttpError(400, "no_language", "This question has no programming language");
  const version = a.currentVersion?.version;

  const pub = result.testResults.filter((t) => t.visibility === "PUBLIC");
  const passed = pub.filter((t) => t.passed).length;
  const codeHash = sha256(input.code);
  const now = new Date();
  const completedAt = now;

  await prisma.$transaction(async (tx) => {
    const data = {
      status: result.status as CodeRunStatus,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: Math.round(result.durationMs),
      testResults: pub as unknown as Prisma.InputJsonValue,
      testsPassed: input.kind === "PUBLIC_TESTS" ? passed : null,
      testsTotal: input.kind === "PUBLIC_TESTS" ? pub.length : null,
      runnerDriver: result.runnerDriver,
      errorClass: result.errorClass,
      completedAt,
    };
    const existing = await tx.codeRun.findUnique({
      where: { id: runId },
      select: { userId: true, queuedAt: true },
    });
    if (existing && existing.userId !== user.id)
      throw new HttpError(403, "run_not_owned", "Run belongs to another user");
    const row = existing
      ? await tx.codeRun.update({ where: { id: runId }, data })
      : await tx.codeRun.create({
          data: {
            id: runId,
            userId: user.id,
            courseId: a.courseId,
            assignmentId: input.assignmentId,
            questionId: input.questionId,
            kind: input.kind,
            language,
            codeSnapshot: input.code,
            codeHash,
            stdin: input.stdin ?? null,
            draftVersion: input.draftVersion ?? null,
            startedAt: now,
            ...data,
          },
        });
    if (version) {
      await writeEvent(tx, {
        eventName: "code_run_requested",
        actorId: user.id,
        courseId: a.courseId,
        assignmentId: input.assignmentId,
        assignmentVersion: version,
        questionId: input.questionId,
        questionVersion: qv?.version,
        occurredAt: row.queuedAt,
        idempotencyKey: `code_run_requested:${runId}`,
        metadata: { runId, kind: input.kind, language, codeHash },
      });
      await writeEvent(tx, {
        eventName: "code_run_completed",
        actorId: user.id,
        courseId: a.courseId,
        assignmentId: input.assignmentId,
        assignmentVersion: version,
        questionId: input.questionId,
        questionVersion: qv?.version,
        idempotencyKey: `code_run_completed:${runId}`,
        metadata: {
          runId,
          kind: input.kind,
          language,
          status: result.status,
          durationMs: Math.max(0, Math.round(result.durationMs)),
          ...(input.kind === "PUBLIC_TESTS"
            ? { publicTestSummary: { passed, total: pub.length } }
            : {}),
          ...(result.errorClass ? { errorClass: result.errorClass } : {}),
        },
      });
    }
    await tx.assignmentProgress.upsert({
      where: { userId_assignmentId: { userId: user.id, assignmentId: input.assignmentId } },
      create: {
        userId: user.id,
        assignmentId: input.assignmentId,
        status: "IN_PROGRESS",
        firstOpenedAt: now,
        lastActivityAt: now,
      },
      update: { lastActivityAt: now },
    });
    await tx.assignmentProgress.updateMany({
      where: { userId: user.id, assignmentId: input.assignmentId, status: "NOT_STARTED" },
      data: { status: "IN_PROGRESS" },
    });
  });
  return { codeRunId: runId, stored: true };
}
