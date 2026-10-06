import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { recordEvent, writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";
import { syncAssignmentState } from "@/server/domain/assignments/service";
import { acceptsSubmissions } from "@/server/domain/assignments/state-machine";
import { sha256, stableHash } from "@/server/domain/assignments/test-mapping";

export interface CreateSubmissionInput {
  assignmentId: string;
  idempotencyKey: string;
  answers: Array<{ questionId: string; content: string }>;
  clientVersion?: string;
}

export interface SubmissionReceipt {
  submissionId: string;
  attemptNumber: number;
  submittedAt: Date;
  status: string;
  /** True when this call returned an earlier submission for the same idempotencyKey. */
  duplicate: boolean;
}

const MAX_ANSWER_BYTES = 200_000;

async function fail(
  user: CurrentUser,
  a: { id: string; courseId: string; version: number | null },
  reason: string,
  status: number,
  code: string,
): Promise<never> {
  if (a.version) {
    await recordEvent({
      eventName: "submission_failed",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId: a.id,
      assignmentVersion: a.version,
      idempotencyKey: `submission_failed:${user.id}:${a.id}:${reason}:${Math.floor(Date.now() / 60_000)}`,
      metadata: { reason },
    });
  }
  throw new HttpError(status, code, reason);
}

/**
 * Create an immutable submission snapshot. Idempotent on `idempotencyKey`: a repeated POST returns the original.
 * submission_started and submission_completed are written in the same transaction as the Submission row.
 * Grading is separate (gradeSubmission) so a slow or unavailable runner never blocks or fails a submission.
 */
export async function createSubmission(
  user: CurrentUser,
  input: CreateSubmissionInput,
): Promise<SubmissionReceipt> {
  const toReceipt = (
    s: { id: string; attemptNumber: number; submittedAt: Date; status: string },
    duplicate: boolean,
  ): SubmissionReceipt => ({
    submissionId: s.id,
    attemptNumber: s.attemptNumber,
    submittedAt: s.submittedAt,
    status: s.status,
    duplicate,
  });

  const prior = await prisma.submission.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (prior) {
    if (prior.userId !== user.id || prior.assignmentId !== input.assignmentId) {
      throw new HttpError(409, "idempotency_key_conflict", "This idempotency key was already used");
    }
    return toReceipt(prior, true);
  }

  const head = await prisma.assignment.findUnique({
    where: { id: input.assignmentId },
    select: { courseId: true },
  });
  if (!head) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, "submission:create_own", { courseId: head.courseId, ownerId: user.id });
  await syncAssignmentState(input.assignmentId);

  const a = await prisma.assignment.findUniqueOrThrow({
    where: { id: input.assignmentId },
    select: {
      id: true,
      courseId: true,
      state: true,
      openAt: true,
      closeAt: true,
      dueAt: true,
      attemptLimit: true,
      allowResubmission: true,
      language: true,
      currentVersion: { select: { id: true, version: true, policyVersionId: true } },
      questions: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          currentVersion: { select: { id: true, version: true, type: true, language: true } },
        },
      },
    },
  });
  const ref = { id: a.id, courseId: a.courseId, version: a.currentVersion?.version ?? null };
  if (!a.currentVersion || a.state === "DRAFT" || a.state === "ARCHIVED") {
    throw new HttpError(404, "assignment_not_found", "Assignment not found");
  }
  if (a.state === "CLOSED") await fail(user, ref, "assignment_closed", 409, "assignment_closed");
  if (!acceptsSubmissions({ state: a.state, openAt: a.openAt, closeAt: a.closeAt })) {
    await fail(user, ref, "assignment_not_open", 409, "assignment_not_open");
  }

  // Answers: client-supplied content wins; missing questions fall back to the server draft.
  const byQ = new Map<string, string>();
  for (const ans of input.answers) {
    if (!a.questions.some((q) => q.id === ans.questionId)) {
      throw new HttpError(
        400,
        "unknown_question",
        "Answer refers to a question not in this assignment",
      );
    }
    if (byQ.has(ans.questionId))
      throw new HttpError(400, "duplicate_answer", "Duplicate answer for a question");
    if (Buffer.byteLength(ans.content, "utf8") > MAX_ANSWER_BYTES) {
      throw new HttpError(413, "answer_too_large", "Answer is too large");
    }
    byQ.set(ans.questionId, ans.content);
  }
  const drafts = await prisma.draft.findMany({
    where: {
      userId: user.id,
      assignmentId: a.id,
      questionId: { in: a.questions.map((q) => q.id) },
    },
    select: { questionId: true, content: true },
  });
  const answerRows = a.questions
    .filter((q) => q.currentVersion)
    .map((q) => {
      const content = byQ.get(q.id) ?? drafts.find((d) => d.questionId === q.id)?.content ?? "";
      const v = q.currentVersion!;
      return {
        questionId: q.id,
        questionVersionId: v.id,
        questionVersion: v.version,
        type: v.type,
        language: v.language ?? a.language ?? null,
        content,
        contentHash: sha256(content),
      };
    });
  if (answerRows.every((r) => r.content.trim() === "")) {
    throw new HttpError(400, "empty_submission", "Add an answer before submitting");
  }

  // Public test summary: latest PUBLIC_TESTS run of exactly this code, per coding question.
  const pubRuns = await prisma.codeRun.findMany({
    where: {
      userId: user.id,
      assignmentId: a.id,
      kind: "PUBLIC_TESTS",
      completedAt: { not: null },
      questionId: { in: answerRows.map((r) => r.questionId) },
    },
    orderBy: { queuedAt: "desc" },
    select: { questionId: true, codeHash: true, testsPassed: true, testsTotal: true },
  });
  const publicTestSummary = answerRows
    .filter((r) => r.type === "CODING")
    .map((r) => {
      const run = pubRuns.find(
        (p) => p.questionId === r.questionId && p.codeHash === r.contentHash,
      );
      return {
        questionId: r.questionId,
        ran: !!run,
        passed: run?.testsPassed ?? null,
        total: run?.testsTotal ?? null,
      };
    });

  const participant = await prisma.studyParticipant.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: a.courseId } },
    select: { condition: true, withdrawnAt: true },
  });
  const policyVersion = a.currentVersion.policyVersionId
    ? ((
        await prisma.socraPolicyVersion.findUnique({
          where: { id: a.currentVersion.policyVersionId },
          select: { version: true },
        })
      )?.version ?? null)
    : null;

  const snapshot = {
    assignmentVersion: a.currentVersion.version,
    answers: answerRows.map((r) => ({
      questionId: r.questionId,
      questionVersionId: r.questionVersionId,
      questionVersion: r.questionVersion,
      language: r.language,
      content: r.content,
      contentHash: r.contentHash,
    })),
  };
  const snapshotHash = stableHash(snapshot);
  const now = new Date();
  const isLate = !!a.dueAt && now.getTime() > a.dueAt.getTime();

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const count = await tx.submission.count({ where: { userId: user.id, assignmentId: a.id } });
        if (a.attemptLimit !== null && count >= a.attemptLimit) {
          throw new HttpError(409, "attempt_limit_reached", "You have used every attempt");
        }
        if (!a.allowResubmission && count >= 1) {
          throw new HttpError(
            409,
            "resubmission_not_allowed",
            "Resubmission is not allowed for this assignment",
          );
        }
        const attemptNumber = count + 1;
        const sub = await tx.submission.create({
          data: {
            userId: user.id,
            assignmentId: a.id,
            assignmentVersionId: a.currentVersion!.id,
            courseId: a.courseId,
            attemptNumber,
            idempotencyKey: input.idempotencyKey,
            status: "RECEIVED",
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            snapshotHash,
            publicTestSummary: publicTestSummary as unknown as Prisma.InputJsonValue,
            researchCondition:
              participant && !participant.withdrawnAt ? participant.condition : null,
            policyVersion,
            clientVersion: input.clientVersion ?? null,
            isLate,
            submittedAt: now,
            answers: {
              create: answerRows.map((r) => ({
                questionId: r.questionId,
                questionVersionId: r.questionVersionId,
                content: r.content,
                language: r.language,
                contentHash: r.contentHash,
              })),
            },
          },
        });
        await writeEvent(tx, {
          eventName: "submission_started",
          actorId: user.id,
          courseId: a.courseId,
          assignmentId: a.id,
          assignmentVersion: a.currentVersion!.version,
          occurredAt: now,
          idempotencyKey: `submission_started:${sub.id}`,
          metadata: { attemptNumber },
        });
        await writeEvent(tx, {
          eventName: "submission_completed",
          actorId: user.id,
          courseId: a.courseId,
          assignmentId: a.id,
          assignmentVersion: a.currentVersion!.version,
          idempotencyKey: `submission_completed:${sub.id}`,
          metadata: { submissionId: sub.id, attemptNumber, snapshotHash, isLate },
        });
        await tx.assignmentProgress.upsert({
          where: { userId_assignmentId: { userId: user.id, assignmentId: a.id } },
          create: {
            userId: user.id,
            assignmentId: a.id,
            status: "SUBMITTED",
            attemptsUsed: attemptNumber,
            latestSubmissionId: sub.id,
            firstOpenedAt: now,
            lastActivityAt: now,
            submittedAt: now,
          },
          update: {
            status: "SUBMITTED",
            attemptsUsed: attemptNumber,
            latestSubmissionId: sub.id,
            lastActivityAt: now,
            submittedAt: now,
          },
        });
        return toReceipt(sub, false);
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        const dup = await prisma.submission.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (dup && dup.userId === user.id) return toReceipt(dup, true);
        continue; // attempt-number race: recount and retry
      }
      throw err;
    }
  }
  throw new HttpError(409, "submission_conflict", "Could not record the submission. Try again.");
}

/** Student's own submissions for an assignment (own data only). */
export async function listOwnSubmissions(user: CurrentUser, assignmentId: string) {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, "submission:read_own", { courseId: a.courseId, ownerId: user.id });
  return prisma.submission.findMany({
    where: { userId: user.id, assignmentId },
    orderBy: { attemptNumber: "desc" },
    select: { id: true, attemptNumber: true, submittedAt: true, status: true, isLate: true },
  });
}
