import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { writeAudit } from "@/server/audit";
import { writeEvent } from "@/server/events";
import { isEnabled } from "@/server/flags";
import { HttpError } from "@/server/http";
import { testCaseToSpec, type TestCaseRow } from "@/server/domain/assignments/test-mapping";
import type { TestResult } from "@/server/runner/types";
import {
  clampPoints,
  computeRubricPoints,
  computeTestPoints,
  isPurelyDeterministic,
  overallStatus,
  resolveFinalScore,
  round2,
  testPointsAvailable,
  type QuestionGradeStatus,
} from "./score";
import { isPlatformFailure, runGradingTests } from "./runner";
import { suggestWrittenGradeSafe } from "./ai-suggestion";

// ---------------------------------------------------------------------------------------------------------------
// Types stored in Grade.gradingResults (SERVER-ONLY: includes hidden test names and outcomes)
// ---------------------------------------------------------------------------------------------------------------

export interface StoredTestResult {
  testId: string;
  name: string;
  visibility: "PUBLIC" | "HIDDEN" | "DIAGNOSTIC";
  passed: boolean;
  weight: number;
  message?: string;
  status?: string;
}

export interface GradingResults {
  kind: "tests" | "manual" | "multiple_choice";
  /** Set while the runner was unreachable; the grade is retryable. */
  pending?: "PENDING_RUNNER";
  reason?: string;
  runId?: string;
  runStatus?: string;
  tests?: StoredTestResult[];
  testPoints?: number;
  testPointsMax?: number;
  computedAt: string;
}

const asResults = (v: unknown): GradingResults | null =>
  v && typeof v === "object" ? (v as GradingResults) : null;

// ---------------------------------------------------------------------------------------------------------------
// Automatic grading
// ---------------------------------------------------------------------------------------------------------------

function mcCorrect(answerKey: unknown, content: string): boolean {
  const key =
    answerKey && typeof answerKey === "object" && !Array.isArray(answerKey)
      ? (answerKey as { correct?: unknown }).correct
      : answerKey;
  if (key === undefined || key === null) return false;
  return String(key).trim().toLowerCase() === content.trim().toLowerCase();
}

/**
 * Grade every answer in a submission. Coding: run ALL tests (public + hidden) with kind GRADING, weighted score.
 * Questions that already have a non-pending grade are left alone, so this is safe to call again as a retry.
 * If the runner is unavailable the grade stays PENDING (retryable); nothing is fabricated.
 */
export async function gradeSubmission(
  submissionId: string,
): Promise<{ status: QuestionGradeStatus }> {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      assignmentId: true,
      status: true,
      assignmentVersion: { select: { version: true } },
      answers: {
        select: {
          questionId: true,
          content: true,
          language: true,
          contentHash: true,
          questionVersion: {
            select: {
              id: true,
              version: true,
              type: true,
              points: true,
              entryPoint: true,
              answerKey: true,
              testCases: { orderBy: { order: "asc" } },
              question: {
                select: {
                  rubrics: {
                    select: { id: true, version: true, criteria: { orderBy: { order: "asc" } } },
                  },
                  order: true,
                },
              },
            },
          },
        },
      },
      grades: { select: { scopeKey: true, status: true, graderType: true } },
    },
  });
  if (!sub) throw new HttpError(404, "submission_not_found", "Submission not found");
  if (sub.status === "RECEIVED") {
    await prisma.submission.update({ where: { id: sub.id }, data: { status: "GRADING" } });
  }

  const answers = [...sub.answers].sort(
    (a, b) => a.questionVersion.question.order - b.questionVersion.question.order,
  );

  for (const ans of answers) {
    const existing = sub.grades.find((g) => g.scopeKey === ans.questionId);
    if (existing && existing.status !== "PENDING") continue;
    const qv = ans.questionVersion;
    const rubric = qv.question.rubrics[0];
    const criteria = rubric?.criteria ?? [];
    let data: Prisma.GradeUncheckedCreateInput;
    const base = {
      submissionId: sub.id,
      questionId: ans.questionId,
      scope: "QUESTION" as const,
      scopeKey: ans.questionId,
      maxPoints: qv.points,
      rubricId: rubric?.id ?? null,
      rubricVersion: rubric?.version ?? null,
    };

    if (qv.type === "CODING") {
      const language = ans.language;
      const tests = qv.testCases
        .filter((t) => t.visibility !== "DIAGNOSTIC")
        .map((t) => testCaseToSpec(t as unknown as TestCaseRow, qv.entryPoint));
      const gradable = tests.some((t) => t.weight > 0);
      if (!language || !gradable) {
        data = {
          ...base,
          method: "MANUAL",
          graderType: "SYSTEM",
          status: "SUGGESTED",
          gradingResults: {
            kind: "manual",
            reason: gradable ? "No language" : "No gradable tests",
            computedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonValue,
        };
      } else {
        const run = await prisma.codeRun.create({
          data: {
            userId: sub.userId,
            courseId: sub.courseId,
            assignmentId: sub.assignmentId,
            questionId: ans.questionId,
            submissionId: sub.id,
            kind: "GRADING",
            language,
            status: "RUNNING",
            codeSnapshot: ans.content,
            codeHash: ans.contentHash,
            startedAt: new Date(),
          },
          select: { id: true },
        });
        const result = await runGradingTests({ runId: run.id, language, code: ans.content, tests });
        if (isPlatformFailure(result)) {
          await prisma.codeRun.update({
            where: { id: run.id },
            data: {
              status: "RUNNER_UNAVAILABLE",
              stderr: result.stderr.slice(0, 2000),
              runnerDriver: result.runnerDriver,
              errorClass: result.errorClass,
              completedAt: new Date(),
            },
          });
          data = {
            ...base,
            method: "DETERMINISTIC_TESTS",
            graderType: "SYSTEM",
            status: "PENDING",
            gradingResults: {
              kind: "tests",
              pending: "PENDING_RUNNER",
              reason: result.stderr.slice(0, 500) || "Code runner unavailable",
              runId: run.id,
              computedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
          };
        } else {
          const byId = new Map<string, TestResult>(result.testResults.map((r) => [r.testId, r]));
          const stored: StoredTestResult[] = tests.map((t) => {
            const r = byId.get(t.id);
            return {
              testId: t.id,
              name: t.name,
              visibility: t.visibility,
              passed: r?.passed === true,
              weight: t.weight,
              message:
                r?.message ??
                (r
                  ? undefined
                  : result.status === "OK"
                    ? "No result reported"
                    : `Run ended with ${result.status}`),
              status: r?.status,
            };
          });
          const testPoints = computeTestPoints(stored, qv.points, criteria);
          const passed = stored.filter((s) => s.passed).length;
          const pure = isPurelyDeterministic({
            type: "CODING",
            rubricCriteria: criteria.length,
            hasGradableTests: gradable,
          });
          await prisma.codeRun.update({
            where: { id: run.id },
            data: {
              status: result.status,
              stdout: result.stdout.slice(0, 20_000),
              stderr: result.stderr.slice(0, 20_000),
              exitCode: result.exitCode,
              durationMs: Math.round(result.durationMs),
              testResults: stored.filter(
                (s) => s.visibility === "PUBLIC",
              ) as unknown as Prisma.InputJsonValue,
              testsPassed: passed,
              testsTotal: stored.length,
              runnerDriver: result.runnerDriver,
              errorClass: result.errorClass,
              completedAt: new Date(),
            },
          });
          const gradingResults: GradingResults = {
            kind: "tests",
            runId: run.id,
            runStatus: result.status,
            tests: stored,
            testPoints,
            testPointsMax: testPointsAvailable(qv.points, criteria),
            computedAt: new Date().toISOString(),
          };
          data = {
            ...base,
            rawPoints: testPoints,
            method: criteria.length > 0 ? "MIXED" : "DETERMINISTIC_TESTS",
            graderType: "SYSTEM",
            status: pure ? "FINAL" : "SUGGESTED",
            finalScore: pure ? testPoints : null,
            testsPassed: passed,
            testsTotal: stored.length,
            gradingResults: gradingResults as unknown as Prisma.InputJsonValue,
            gradedAt: pure ? new Date() : null,
          };
        }
      }
    } else if (qv.type === "MULTIPLE_CHOICE" && qv.answerKey !== null) {
      const ok = mcCorrect(qv.answerKey, ans.content);
      const pts = ok ? qv.points : 0;
      data = {
        ...base,
        rawPoints: pts,
        method: "DETERMINISTIC_TESTS",
        graderType: "SYSTEM",
        status: "FINAL",
        finalScore: pts,
        gradingResults: {
          kind: "multiple_choice",
          testPoints: pts,
          testPointsMax: qv.points,
          computedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
        gradedAt: new Date(),
      };
    } else {
      // Written responses are never final without a person.
      data = {
        ...base,
        method: criteria.length > 0 ? "RUBRIC" : "MANUAL",
        graderType: "SYSTEM",
        status: "SUGGESTED",
        gradingResults: {
          kind: "manual",
          computedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      };
    }

    await prisma.grade.upsert({
      where: { submissionId_scopeKey: { submissionId: sub.id, scopeKey: ans.questionId } },
      create: data,
      update: {
        rawPoints: data.rawPoints,
        method: data.method,
        status: data.status,
        finalScore: data.finalScore ?? null,
        testsPassed: data.testsPassed ?? null,
        testsTotal: data.testsTotal ?? null,
        gradingResults: data.gradingResults,
        gradedAt: data.gradedAt ?? null,
        rubricId: data.rubricId,
        rubricVersion: data.rubricVersion,
      },
    });
  }

  return finishSubmissionGrading(sub.id, sub.assignmentVersion.version);
}

/** Recompute the overall SUBMISSION grade and submission status from the per-question grades; emit the event. */
async function finishSubmissionGrading(
  submissionId: string,
  assignmentVersion: number,
): Promise<{ status: QuestionGradeStatus }> {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { userId: true, courseId: true, assignmentId: true },
    });
    const qgrades = await tx.grade.findMany({ where: { submissionId, scope: "QUESTION" } });
    const status = overallStatus(qgrades.map((g) => g.status));
    const max = round2(qgrades.reduce((s, g) => s + g.maxPoints, 0));
    const raw = qgrades.some((g) => g.rawPoints !== null)
      ? round2(qgrades.reduce((s, g) => s + (g.rawPoints ?? 0), 0))
      : null;
    const allSystem = qgrades.every((g) => g.graderType === "SYSTEM");
    const final =
      status === "FINAL" ? round2(qgrades.reduce((s, g) => s + (g.finalScore ?? 0), 0)) : null;
    const overall = await tx.grade.findUnique({
      where: { submissionId_scopeKey: { submissionId, scopeKey: "overall" } },
      select: { graderType: true, status: true, releasedAt: true },
    });
    // Never overwrite an instructor-finalized overall grade.
    if (overall?.graderType !== "INSTRUCTOR" || overall.status !== "FINAL") {
      await tx.grade.upsert({
        where: { submissionId_scopeKey: { submissionId, scopeKey: "overall" } },
        create: {
          submissionId,
          scope: "SUBMISSION",
          scopeKey: "overall",
          rawPoints: raw,
          maxPoints: max,
          method: allSystem ? "DETERMINISTIC_TESTS" : "MIXED",
          graderType: "SYSTEM",
          status,
          finalScore: final,
          gradedAt: status === "FINAL" ? new Date() : null,
        },
        update: {
          rawPoints: raw,
          maxPoints: max,
          method: allSystem ? "DETERMINISTIC_TESTS" : "MIXED",
          status,
          finalScore: final,
          gradedAt: status === "FINAL" ? new Date() : null,
        },
      });
    }
    await tx.submission.updateMany({
      where: { id: submissionId, status: { in: ["RECEIVED", "GRADING"] } },
      data: status === "FINAL" ? { status: "GRADED", gradedAt: new Date() } : { status: "GRADING" },
    });

    if (status !== "PENDING") {
      const det = qgrades.filter((g) => asResults(g.gradingResults)?.kind !== "manual");
      if (det.length > 0) {
        await writeEvent(tx, {
          eventName: "deterministic_grade_completed",
          actorId: sub.userId,
          courseId: sub.courseId,
          assignmentId: sub.assignmentId,
          assignmentVersion,
          idempotencyKey: `deterministic_grade_completed:${submissionId}`,
          metadata: {
            submissionId,
            score: round2(
              det.reduce((s, g) => s + (asResults(g.gradingResults)?.testPoints ?? 0), 0),
            ),
            maxScore: round2(det.reduce((s, g) => s + g.maxPoints, 0)),
            testsPassed: det.reduce((s, g) => s + (g.testsPassed ?? 0), 0),
            testsTotal: det.reduce((s, g) => s + (g.testsTotal ?? 0), 0),
          },
        });
      }
    }
    return { status };
  });
}

/** Re-run grading for submissions whose grade is PENDING because the runner was unreachable. */
export async function retryPendingGrades(limit = 25): Promise<number> {
  const pending = await prisma.grade.findMany({
    where: { status: "PENDING", scope: "QUESTION" },
    distinct: ["submissionId"],
    take: limit,
    orderBy: { createdAt: "asc" },
    select: { submissionId: true },
  });
  let done = 0;
  for (const p of pending) {
    const r = await gradeSubmission(p.submissionId).catch(() => null);
    if (r && r.status !== "PENDING") done += 1;
  }
  return done;
}

export async function retryGrading(user: CurrentUser, submissionId: string) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { courseId: true },
  });
  if (!s) throw new HttpError(404, "submission_not_found", "Submission not found");
  assertCan(user, "grade:write", { courseId: s.courseId });
  return gradeSubmission(submissionId);
}

// ---------------------------------------------------------------------------------------------------------------
// Faculty reads
// ---------------------------------------------------------------------------------------------------------------

export interface SubmissionRow {
  userId: string;
  name: string;
  email: string;
  progress: string;
  attemptsUsed: number;
  submissionId: string | null;
  attemptNumber: number | null;
  submittedAt: Date | null;
  isLate: boolean;
  gradeStatus: "NONE" | "PENDING_RUNNER" | "PENDING" | "SUGGESTED" | "FINAL";
  score: number | null;
  maxScore: number | null;
  released: boolean;
}

export async function listSubmissionsForAssignment(
  user: CurrentUser,
  assignmentId: string,
): Promise<{
  assignment: { id: string; title: string; courseId: string; state: string; totalPoints: number };
  rows: SubmissionRow[];
}> {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, title: true, courseId: true, state: true, totalPoints: true },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, "submission:read_course", { courseId: a.courseId });
  const students = await prisma.courseMembership.findMany({
    where: { courseId: a.courseId, role: "STUDENT", status: "ACTIVE" },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const [progress, subs] = await Promise.all([
    prisma.assignmentProgress.findMany({ where: { assignmentId } }),
    prisma.submission.findMany({
      where: { assignmentId },
      orderBy: { attemptNumber: "desc" },
      select: {
        id: true,
        userId: true,
        attemptNumber: true,
        submittedAt: true,
        isLate: true,
        grades: {
          select: {
            scope: true,
            status: true,
            finalScore: true,
            rawPoints: true,
            maxPoints: true,
            releasedAt: true,
            gradingResults: true,
          },
        },
      },
    }),
  ]);
  const rows: SubmissionRow[] = students
    .map((m) => {
      const p = progress.find((x) => x.userId === m.user.id);
      const latest = subs.find((s) => s.userId === m.user.id);
      const overall = latest?.grades.find((g) => g.scope === "SUBMISSION");
      const pendingRunner = latest?.grades.some(
        (g) => asResults(g.gradingResults)?.pending === "PENDING_RUNNER" && g.status === "PENDING",
      );
      return {
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        progress: p?.status ?? "NOT_STARTED",
        attemptsUsed: p?.attemptsUsed ?? 0,
        submissionId: latest?.id ?? null,
        attemptNumber: latest?.attemptNumber ?? null,
        submittedAt: latest?.submittedAt ?? null,
        isLate: latest?.isLate ?? false,
        gradeStatus: !latest
          ? "NONE"
          : pendingRunner
            ? "PENDING_RUNNER"
            : (overall?.status ?? "PENDING"),
        score: overall ? (overall.finalScore ?? overall.rawPoints ?? null) : null,
        maxScore: overall?.maxPoints ?? null,
        released: !!overall?.releasedAt,
      } satisfies SubmissionRow;
    })
    .sort((x, y) => x.name.localeCompare(y.name));
  return { assignment: a, rows };
}

export interface GradingQuestionView {
  questionId: string;
  title: string;
  prompt: string;
  type: string;
  points: number;
  language: string | null;
  answer: string;
  gradeId: string | null;
  status: string;
  pendingRunner: boolean;
  pendingReason: string | null;
  testPoints: number | null;
  testPointsMax: number | null;
  /** Includes HIDDEN test names and outcomes: faculty only. */
  tests: StoredTestResult[];
  criteria: Array<{ id: string; title: string; description: string; maxPoints: number }>;
  criterionScores: Record<string, number>;
  rawPoints: number | null;
  finalScore: number | null;
  facultyOverride: number | null;
  feedback: string | null;
  aiSuggestion: unknown;
  aiAvailable: boolean;
}

export interface GradingView {
  submissionId: string;
  assignment: { id: string; title: string; courseId: string; totalPoints: number };
  student: { id: string; name: string; email: string };
  attemptNumber: number;
  attempts: Array<{ id: string; attemptNumber: number; submittedAt: Date }>;
  submittedAt: Date;
  isLate: boolean;
  status: string;
  researchCondition: string | null;
  publicTestSummary: unknown;
  questions: GradingQuestionView[];
  overall: {
    status: string;
    rawPoints: number | null;
    finalScore: number | null;
    maxPoints: number;
    releasedAt: Date | null;
  } | null;
  overrides: Array<{
    id: string;
    previousScore: number | null;
    newScore: number;
    reason: string;
    createdAt: Date;
    actor: string;
  }>;
  canFinalize: boolean;
}

export async function getSubmissionForGrading(
  user: CurrentUser,
  submissionId: string,
): Promise<GradingView> {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignment: { select: { id: true, title: true, courseId: true, totalPoints: true } },
      answers: {
        include: {
          questionVersion: {
            select: {
              title: true,
              prompt: true,
              type: true,
              points: true,
              question: {
                select: {
                  order: true,
                  rubrics: { select: { criteria: { orderBy: { order: "asc" } } } },
                },
              },
            },
          },
        },
      },
      grades: {
        include: {
          overrides: {
            orderBy: { createdAt: "desc" },
            include: { actor: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!s) throw new HttpError(404, "submission_not_found", "Submission not found");
  assertCan(user, "submission:read_course", { courseId: s.assignment.courseId });
  assertCan(user, "assignment:hidden_tests:read", { courseId: s.assignment.courseId });
  const attempts = await prisma.submission.findMany({
    where: { userId: s.userId, assignmentId: s.assignmentId },
    orderBy: { attemptNumber: "asc" },
    select: { id: true, attemptNumber: true, submittedAt: true },
  });
  const aiEnabled = await isEnabled("aiGradingSuggestions", { courseId: s.assignment.courseId });
  const answers = [...s.answers].sort(
    (a, b) => a.questionVersion.question.order - b.questionVersion.question.order,
  );
  const questions: GradingQuestionView[] = answers.map((ans) => {
    const g = s.grades.find((x) => x.scopeKey === ans.questionId);
    const res = asResults(g?.gradingResults);
    const qv = ans.questionVersion;
    return {
      questionId: ans.questionId,
      title: qv.title,
      prompt: qv.prompt,
      type: qv.type,
      points: qv.points,
      language: ans.language,
      answer: ans.content,
      gradeId: g?.id ?? null,
      status: g?.status ?? "PENDING",
      pendingRunner: res?.pending === "PENDING_RUNNER",
      pendingReason: res?.reason ?? null,
      testPoints: res?.testPoints ?? null,
      testPointsMax: res?.testPointsMax ?? null,
      tests: res?.tests ?? [],
      criteria: (qv.question.rubrics[0]?.criteria ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        maxPoints: c.maxPoints,
      })),
      criterionScores: (g?.criterionScores as Record<string, number> | null) ?? {},
      rawPoints: g?.rawPoints ?? null,
      finalScore: g?.finalScore ?? null,
      facultyOverride: g?.facultyOverride ?? null,
      feedback: g?.feedback ?? null,
      aiSuggestion: g?.aiSuggestion ?? null,
      aiAvailable: aiEnabled && qv.type !== "CODING" && qv.type !== "MULTIPLE_CHOICE",
    };
  });
  const overall = s.grades.find((g) => g.scope === "SUBMISSION") ?? null;
  return {
    submissionId: s.id,
    assignment: s.assignment,
    student: s.user,
    attemptNumber: s.attemptNumber,
    attempts,
    submittedAt: s.submittedAt,
    isLate: s.isLate,
    status: s.status,
    researchCondition: s.researchCondition,
    publicTestSummary: s.publicTestSummary,
    questions,
    overall: overall
      ? {
          status: overall.status,
          rawPoints: overall.rawPoints,
          finalScore: overall.finalScore,
          maxPoints: overall.maxPoints,
          releasedAt: overall.releasedAt,
        }
      : null,
    overrides: s.grades.flatMap((g) =>
      g.overrides.map((o) => ({
        id: o.id,
        previousScore: o.previousScore,
        newScore: o.newScore,
        reason: o.reason,
        createdAt: o.createdAt,
        actor: o.actor.name,
      })),
    ),
    canFinalize: questions.every((q) => q.status !== "PENDING"),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// AI suggestion (written answers). Never authoritative; tolerate failure.
// ---------------------------------------------------------------------------------------------------------------

export async function requestAiSuggestion(
  user: CurrentUser,
  submissionId: string,
  questionId: string,
) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      courseId: true,
      assignmentId: true,
      assignmentVersion: { select: { version: true } },
    },
  });
  if (!s) throw new HttpError(404, "submission_not_found", "Submission not found");
  assertCan(user, "grade:write", { courseId: s.courseId });
  if (!(await isEnabled("aiGradingSuggestions", { courseId: s.courseId }))) {
    throw new HttpError(
      409,
      "feature_disabled",
      "AI grading suggestions are turned off for this course",
    );
  }
  const grade = await prisma.grade.findUnique({
    where: { submissionId_scopeKey: { submissionId, scopeKey: questionId } },
    select: { id: true, status: true, graderType: true },
  });
  if (!grade) throw new HttpError(404, "grade_not_found", "No grade record for this question");
  if (grade.status === "FINAL" && grade.graderType === "INSTRUCTOR") {
    throw new HttpError(409, "already_final", "This question is already finalized");
  }
  const suggestion = await suggestWrittenGradeSafe(user, { submissionId, questionId });
  if (!suggestion.ok) return { ok: false as const, message: suggestion.message };
  await prisma.$transaction(async (tx) => {
    await tx.grade.update({
      where: { id: grade.id },
      data: { aiSuggestion: suggestion.value as unknown as Prisma.InputJsonValue },
    });
    await writeEvent(tx, {
      eventName: "ai_feedback_generated",
      actorId: user.id,
      courseId: s.courseId,
      assignmentId: s.assignmentId,
      assignmentVersion: s.assignmentVersion.version,
      idempotencyKey: `ai_feedback_generated:${grade.id}:${Date.now()}`,
      metadata: { submissionId, gradeId: grade.id },
    });
  });
  return { ok: true as const, suggestion: suggestion.value };
}

// ---------------------------------------------------------------------------------------------------------------
// Faculty finalize / override
// ---------------------------------------------------------------------------------------------------------------

export const finalizeInputSchema = z.object({
  questions: z
    .array(
      z.object({
        questionId: z.string(),
        /** criterionId -> points (manual rubric scoring). */
        rubricScores: z.record(z.string(), z.number()).optional(),
        /**
         * Final points for the question. Required for written answers without a rubric; for graded questions
         * it is an instructor override of the computed score and needs `overrideReason`.
         */
        points: z.number().min(0).optional(),
        feedback: z.string().max(10_000).optional(),
        overrideReason: z.string().max(2000).optional(),
      }),
    )
    .default([]),
  feedback: z.string().max(10_000).optional(),
});
export type FinalizeInput = z.infer<typeof finalizeInputSchema>;

export async function finalizeGrade(user: CurrentUser, submissionId: string, raw: unknown) {
  const input = finalizeInputSchema.parse(raw);
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      assignmentId: true,
      assignmentVersion: { select: { version: true } },
      answers: {
        select: {
          questionId: true,
          questionVersion: {
            select: {
              type: true,
              points: true,
              question: {
                select: {
                  rubrics: {
                    select: { version: true, criteria: { select: { id: true, maxPoints: true } } },
                  },
                },
              },
            },
          },
        },
      },
      grades: true,
    },
  });
  if (!sub) throw new HttpError(404, "submission_not_found", "Submission not found");
  assertCan(user, "grade:finalize", { courseId: sub.courseId });

  const plans: Array<{
    gradeId: string;
    questionId: string;
    criterionScores: Record<string, number> | null;
    final: number;
    computed: number;
    overridden: boolean;
    previous: number | null;
    reason: string | null;
    feedback: string | null;
    max: number;
    rubricVersion: number | null;
  }> = [];

  for (const ans of sub.answers) {
    const g = sub.grades.find((x) => x.scopeKey === ans.questionId);
    if (!g)
      throw new HttpError(409, "grading_pending", "Grading has not started for every question");
    const res = asResults(g.gradingResults);
    if (g.status === "PENDING") {
      throw new HttpError(
        409,
        "grading_pending",
        "Some tests could not run yet. Retry grading before finalizing.",
      );
    }
    const q = input.questions.find((x) => x.questionId === ans.questionId);
    const rubric = ans.questionVersion.question.rubrics[0];
    const criteria = rubric?.criteria ?? [];
    const max = ans.questionVersion.points;
    const testPts = res?.testPoints ?? 0;
    const scores = q?.rubricScores ?? (g.criterionScores as Record<string, number> | null) ?? {};
    const rubricPts = criteria.length > 0 ? computeRubricPoints(criteria, scores) : 0;
    const hasAutoBasis =
      res?.kind === "tests" || res?.kind === "multiple_choice" || criteria.length > 0;
    let computed: number;
    let override: number | null = null;
    if (hasAutoBasis) {
      computed = clampPoints(testPts + rubricPts, max);
      if (q?.points !== undefined) override = q.points;
    } else {
      // Written, no rubric: the instructor's number is the score, not an override.
      if (q?.points === undefined) {
        if (g.status === "FINAL" && g.finalScore !== null) {
          computed = g.finalScore;
        } else {
          throw new HttpError(
            422,
            "score_required",
            "Enter a score for each written answer before finalizing",
          );
        }
      } else {
        computed = clampPoints(q.points, max);
      }
    }
    // A returned question the instructor did not rescore keeps its grade. Recomputing it from stored test and
    // rubric data could silently replace the returned score (for example with 0 when tests were not recorded).
    const keepReturned =
      g.status === "FINAL" &&
      g.finalScore !== null &&
      q?.points === undefined &&
      q?.rubricScores === undefined;
    const fin = keepReturned
      ? { final: g.finalScore as number, computed: g.finalScore as number, overridden: false }
      : resolveFinalScore({
          maxPoints: max,
          testPoints: hasAutoBasis ? testPts : computed,
          rubricPoints: hasAutoBasis ? rubricPts : 0,
          override,
        });
    const previous = g.finalScore ?? g.rawPoints;
    const overriddenFromFinal =
      g.status === "FINAL" && g.finalScore !== null && g.finalScore !== fin.final;
    const overridden = fin.overridden || overriddenFromFinal;
    if (overridden) {
      assertCan(user, "grade:override", { courseId: sub.courseId });
      if ((q?.overrideReason?.trim().length ?? 0) < 5) {
        throw new HttpError(
          422,
          "override_reason_required",
          "Give a reason for changing a computed or earlier score",
        );
      }
    }
    plans.push({
      gradeId: g.id,
      questionId: ans.questionId,
      criterionScores: criteria.length > 0 ? scores : null,
      final: fin.final,
      computed: fin.computed,
      overridden,
      previous,
      reason: q?.overrideReason?.trim() ?? null,
      feedback: q?.feedback ?? g.feedback ?? null,
      max,
      rubricVersion: rubric?.version ?? null,
    });
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    for (const p of plans) {
      await tx.grade.update({
        where: { id: p.gradeId },
        data: {
          finalScore: p.final,
          facultyOverride: p.overridden ? p.final : null,
          criterionScores: p.criterionScores
            ? (p.criterionScores as unknown as Prisma.InputJsonValue)
            : undefined,
          feedback: p.feedback,
          status: "FINAL",
          graderType: "INSTRUCTOR",
          graderId: user.id,
          gradedAt: now,
          releasedAt: now,
        },
      });
      if (p.overridden) {
        await tx.gradeOverrideAudit.create({
          data: {
            gradeId: p.gradeId,
            actorId: user.id,
            previousScore: p.previous,
            newScore: p.final,
            reason: p.reason ?? "",
          },
        });
        await writeAudit(
          {
            actorId: user.id,
            action: "grade.override",
            targetType: "Grade",
            targetId: p.gradeId,
            courseId: sub.courseId,
            reason: p.reason,
            metadata: {
              submissionId,
              questionId: p.questionId,
              previousScore: p.previous,
              newScore: p.final,
              computed: p.computed,
            },
          },
          tx,
        );
      }
    }
    const total = round2(plans.reduce((s, p) => s + p.final, 0));
    const maxTotal = round2(plans.reduce((s, p) => s + p.max, 0));
    const overall = await tx.grade.upsert({
      where: { submissionId_scopeKey: { submissionId, scopeKey: "overall" } },
      create: {
        submissionId,
        scope: "SUBMISSION",
        scopeKey: "overall",
        rawPoints: total,
        maxPoints: maxTotal,
        method: "MIXED",
        graderType: "INSTRUCTOR",
        status: "FINAL",
        finalScore: total,
        feedback: input.feedback ?? null,
        graderId: user.id,
        gradedAt: now,
        releasedAt: now,
      },
      update: {
        maxPoints: maxTotal,
        graderType: "INSTRUCTOR",
        status: "FINAL",
        finalScore: total,
        feedback: input.feedback ?? null,
        graderId: user.id,
        gradedAt: now,
        releasedAt: now,
      },
    });
    await tx.submission.update({
      where: { id: submissionId },
      data: { status: "RETURNED", gradedAt: now, returnedAt: now },
    });
    await tx.assignmentProgress.updateMany({
      where: {
        userId: sub.userId,
        assignmentId: sub.assignmentId,
        latestSubmissionId: submissionId,
      },
      data: { status: "RETURNED", returnedAt: now },
    });
    const anyOverride = plans.some((p) => p.overridden);
    await writeEvent(tx, {
      eventName: "faculty_grade_finalized",
      actorId: user.id,
      courseId: sub.courseId,
      assignmentId: sub.assignmentId,
      assignmentVersion: sub.assignmentVersion.version,
      idempotencyKey: `faculty_grade_finalized:${overall.id}:${now.getTime()}`,
      metadata: {
        submissionId,
        gradeId: overall.id,
        score: total,
        maxScore: maxTotal,
        rubricVersion: plans.find((p) => p.rubricVersion)?.rubricVersion ?? undefined,
        graderType: "INSTRUCTOR",
        overridden: anyOverride,
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "grade.finalize",
        targetType: "Submission",
        targetId: submissionId,
        courseId: sub.courseId,
        metadata: { score: total, maxScore: maxTotal, overridden: anyOverride },
      },
      tx,
    );
    return { submissionId, finalScore: total, maxScore: maxTotal, overridden: anyOverride };
  });
}
