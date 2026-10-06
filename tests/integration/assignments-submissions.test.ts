import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPrincipal, type CurrentUser } from "@/server/auth/current-user";
import { disconnectPrisma, prisma } from "@/server/db";
import { getCodeRunner, setCodeRunnerForTests } from "@/server/runner";
import {
  runnerUnavailable,
  type CodeRunner,
  type RunJob,
  type RunResult,
} from "@/server/runner/types";
import {
  closeAssignment,
  createAssignment,
  getAssignmentForEdit,
  publishAssignment,
  releaseSolutions,
  reopenAssignment,
} from "@/server/domain/assignments/service";
import { getAssignmentForStudent } from "@/server/domain/assignments/queries";
import { getEffectiveAiMode, getWorkspaceContextForAi } from "@/server/domain/workspace/context";
import { saveDraft } from "@/server/domain/workspace/drafts";
import { recordCodeRun } from "@/server/domain/workspace/runs";
import { createSubmission } from "@/server/domain/submissions/service";
import { finalizeGrade, gradeSubmission } from "@/server/domain/grading/service";

// executeRun normally goes through BullMQ and a worker; route it to the injected CodeRunner for tests.
vi.mock("@/server/runner/service", async () => {
  const { defaultRunLimits } = await import("@/server/runner");
  return {
    executeRun: async (input: {
      runId: string;
      language: "PYTHON" | "JAVASCRIPT" | "SCALA";
      code: string;
      tests: unknown[];
    }) =>
      getCodeRunner().run({
        runId: input.runId,
        language: input.language,
        files: [{ path: "main.py", content: input.code }],
        entryFile: "main.py",
        tests: input.tests as never,
        mode: "tests",
        limits: defaultRunLimits(input.language),
      }),
  };
});

const RUN = randomUUID().slice(0, 8);
const courseId = `itest_c_${RUN}`;
let facultyId = "";
let studentId = "";
let faculty: CurrentUser;
let student: CurrentUser;
let assignmentId = "";
let questionId = "";
const HIDDEN_NAME = `secret-hidden-${RUN}`;
const REF_SOLUTION = `def total(xs): return sum(xs)  # ref ${RUN}`;

/** Passes tests whose name starts with "pass"; fails the rest. Never fabricates when `down`. */
function fakeRunner(down = false): CodeRunner {
  return {
    driver: "fake",
    async run(job: RunJob): Promise<RunResult> {
      if (down) return runnerUnavailable(job.runId, "fake", "runner is down");
      return {
        runId: job.runId,
        status: "OK",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 5,
        truncated: false,
        errorClass: null,
        runnerDriver: "fake",
        testResults: job.tests.map((t) => ({
          testId: t.id,
          name: t.name,
          visibility: t.visibility,
          passed: t.name.startsWith("pass"),
          weight: t.weight,
        })),
      };
    },
    async health() {
      return { driver: "fake", available: !down, languages: {} };
    },
  };
}

beforeAll(async () => {
  await prisma.course.create({
    data: { id: courseId, code: "TST 200", title: "Itest", term: "T", languages: ["PYTHON"] },
  });
  await prisma.topic.create({ data: { courseId, key: "recursion", name: "Recursion" } });
  const f = await prisma.user.create({
    data: {
      email: `fac-${RUN}@socra.local`,
      name: "Faculty",
      roles: ["INSTRUCTOR"],
      memberships: { create: { courseId, role: "INSTRUCTOR" } },
    },
  });
  const s = await prisma.user.create({
    data: {
      email: `stu-${RUN}@socra.local`,
      name: "Student",
      roles: ["STUDENT"],
      memberships: { create: { courseId, role: "STUDENT" } },
    },
  });
  facultyId = f.id;
  studentId = s.id;
  faculty = (await loadPrincipal(facultyId, `fsess-${RUN}`))!;
  student = (await loadPrincipal(studentId, `ssess-${RUN}`))!;
  setCodeRunnerForTests(fakeRunner());
});

afterEach(() => setCodeRunnerForTests(fakeRunner()));

afterAll(async () => {
  setCodeRunnerForTests(undefined);
  await disconnectPrisma();
});

describe("authoring and publishing", () => {
  it("creates a draft with tests, rubric-free coding question and emits events", async () => {
    const suggestion = await prisma.authoringSuggestion.create({
      data: { courseId, kind: "full_assignment", input: {}, content: {}, createdById: facultyId },
    });
    const created = await createAssignment(faculty, {
      courseId,
      title: `Sum ${RUN}`,
      description: "Add numbers.",
      format: "CODING",
      language: "PYTHON",
      attemptLimit: 2,
      solutionReleaseMode: "MANUAL",
      learningObjectives: ["Trace a recursive call"],
      topicKeys: ["recursion"],
      aiSuggestionId: suggestion.id,
      questions: [
        {
          title: "total",
          prompt: "Write total(xs).",
          type: "CODING",
          points: 10,
          entryPoint: "total",
          starterCode: "def total(xs):\n    pass\n",
          referenceSolution: REF_SOLUTION,
          topicKeys: ["recursion"],
          tests: [
            {
              name: "pass public",
              visibility: "PUBLIC",
              weight: 1,
              args: [[1, 2]],
              expectedReturn: 3,
            },
            { name: HIDDEN_NAME, visibility: "HIDDEN", weight: 3, args: [[]], expectedReturn: 0 },
          ],
        },
      ],
    });
    assignmentId = created.id;
    const events = await prisma.analyticsEvent.findMany({ where: { assignmentId } });
    const names = events.map((e) => e.eventName);
    expect(names).toContain("assignment_created");
    expect(names).toContain("assignment_ai_generated");
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.state).toBe("DRAFT");
    expect(a.totalPoints).toBe(10);
    expect(a.aiGenerated).toBe(true);
    const edit = await getAssignmentForEdit(faculty, assignmentId);
    questionId = edit.input.questions[0]!.id!;
    expect(edit.input.questions[0]!.tests).toHaveLength(2);
  });

  it("a student cannot create or read a draft assignment", async () => {
    await expect(
      createAssignment(student, { courseId, title: "x", format: "CODING" }),
    ).rejects.toThrow();
    expect(await getAssignmentForStudent(student, assignmentId)).toBeNull();
  });

  it("publish creates an immutable AssignmentVersion and emits assignment_published", async () => {
    const r = await publishAssignment(faculty, assignmentId);
    expect(r.state).toBe("PUBLISHED_PROTECTED");
    expect(r.version).toBe(1);
    const v = await prisma.assignmentVersion.findUniqueOrThrow({ where: { id: r.versionId } });
    expect(v.snapshotHash).toHaveLength(64);
    const ev = await prisma.analyticsEvent.findFirst({
      where: { assignmentId, eventName: "assignment_published" },
    });
    expect(ev?.assignmentVersion).toBe(1);
    expect(ev?.status).toBe("ACCEPTED");
    await expect(publishAssignment(faculty, assignmentId)).rejects.toThrow(/Cannot/);
  });
});

describe("student view never leaks hidden material", () => {
  it("excludes hidden tests and the reference solution while protected", async () => {
    const view = await getAssignmentForStudent(student, assignmentId);
    expect(view).not.toBeNull();
    const text = JSON.stringify(view);
    expect(text).not.toContain(HIDDEN_NAME);
    expect(text).not.toContain(REF_SOLUTION);
    expect(view!.mode).toBe("PROTECTED_ASSESSMENT");
    expect(view!.questions[0]!.publicTests.map((t) => t.name)).toEqual(["pass public"]);
    const ctx = await getWorkspaceContextForAi(studentId, assignmentId);
    const ctxText = JSON.stringify(ctx);
    expect(ctxText).not.toContain(HIDDEN_NAME);
    expect(ctxText).not.toContain(REF_SOLUTION);
    expect(ctx.workspace.code).toContain("def total");
    const events = await prisma.analyticsEvent.findMany({
      where: { actorId: studentId, assignmentId },
    });
    expect(events.map((e) => e.eventName)).toEqual(
      expect.arrayContaining(["assignment_opened", "question_viewed"]),
    );
  });

  it("opening twice the same session/day emits one assignment_opened", async () => {
    await getAssignmentForStudent(student, assignmentId);
    const n = await prisma.analyticsEvent.count({
      where: { actorId: studentId, assignmentId, eventName: "assignment_opened" },
    });
    expect(n).toBe(1);
  });
});

describe("drafts", () => {
  it("optimistic concurrency returns the server copy on conflict", async () => {
    const first = await saveDraft(student, {
      assignmentId,
      questionId,
      content: "v1",
      baseVersion: 0,
    });
    expect(first).toMatchObject({ ok: true, version: 1 });
    const second = await saveDraft(student, {
      assignmentId,
      questionId,
      content: "v2",
      baseVersion: 1,
    });
    expect(second).toMatchObject({ ok: true, version: 2 });
    const stale = await saveDraft(student, {
      assignmentId,
      questionId,
      content: "other",
      baseVersion: 1,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.conflict.serverVersion).toBe(2);
      expect(stale.conflict.content).toBe("v2");
    }
  });

  it("emits draft_saved at most once per minute per question", async () => {
    await saveDraft(student, { assignmentId, questionId, content: "v3", baseVersion: 2 });
    await saveDraft(student, { assignmentId, questionId, content: "v4", baseVersion: 3 });
    const n = await prisma.analyticsEvent.count({
      where: { actorId: studentId, questionId, eventName: "draft_saved" },
    });
    expect(n).toBe(1);
  });
});

describe("runs", () => {
  it("records a CodeRun with public results only and both events", async () => {
    const runId = `run_${RUN}`;
    await recordCodeRun(
      student,
      { runId, assignmentId, questionId, code: "print(1)", kind: "PUBLIC_TESTS" },
      {
        runId,
        status: "OK",
        stdout: "1",
        stderr: "",
        exitCode: 0,
        durationMs: 12,
        truncated: false,
        errorClass: null,
        runnerDriver: "fake",
        testResults: [
          { testId: "a", name: "pass public", visibility: "PUBLIC", passed: true, weight: 1 },
          { testId: "b", name: HIDDEN_NAME, visibility: "HIDDEN", passed: false, weight: 3 },
        ],
      },
    );
    const row = await prisma.codeRun.findUniqueOrThrow({ where: { id: runId } });
    expect(JSON.stringify(row.testResults)).not.toContain(HIDDEN_NAME);
    expect(row.testsPassed).toBe(1);
    expect(row.testsTotal).toBe(1);
    const names = (
      await prisma.analyticsEvent.findMany({
        where: {
          idempotencyKey: { in: [`code_run_requested:${runId}`, `code_run_completed:${runId}`] },
        },
      })
    ).map((e) => e.eventName);
    expect(names.sort()).toEqual(["code_run_completed", "code_run_requested"]);
  });
});

describe("submissions", () => {
  let firstId = "";
  const key = `idem-${RUN}-1`;

  it("is idempotent on idempotencyKey", async () => {
    const a = await createSubmission(student, {
      assignmentId,
      idempotencyKey: key,
      answers: [{ questionId, content: "def total(xs): return 3" }],
    });
    const b = await createSubmission(student, {
      assignmentId,
      idempotencyKey: key,
      answers: [{ questionId, content: "different" }],
    });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.submissionId).toBe(a.submissionId);
    firstId = a.submissionId;
    expect(await prisma.submission.count({ where: { userId: studentId, assignmentId } })).toBe(1);
    const sub = await prisma.submission.findUniqueOrThrow({
      where: { id: firstId },
      include: { answers: true },
    });
    expect(sub.answers[0]!.content).toBe("def total(xs): return 3");
    expect(sub.snapshotHash).toHaveLength(64);
    for (const name of ["submission_started", "submission_completed"]) {
      expect(
        await prisma.analyticsEvent.count({
          where: { assignmentId, actorId: studentId, eventName: name },
        }),
      ).toBe(1);
    }
  });

  it("concurrent duplicate posts produce one submission", async () => {
    const k = `idem-${RUN}-race`;
    const [x, y] = await Promise.allSettled([
      createSubmission(student, {
        assignmentId,
        idempotencyKey: k,
        answers: [{ questionId, content: "r" }],
      }),
      createSubmission(student, {
        assignmentId,
        idempotencyKey: k,
        answers: [{ questionId, content: "r" }],
      }),
    ]);
    expect(x.status).toBe("fulfilled");
    expect(y.status).toBe("fulfilled");
    if (x.status === "fulfilled" && y.status === "fulfilled")
      expect(x.value.submissionId).toBe(y.value.submissionId);
    expect(await prisma.submission.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it("enforces the attempt limit", async () => {
    // attempts used: first + race = 2 (limit 2)
    await expect(
      createSubmission(student, {
        assignmentId,
        idempotencyKey: `idem-${RUN}-3`,
        answers: [{ questionId, content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "attempt_limit_reached" });
  });

  it("submitting early does not unlock review mode", async () => {
    expect(await getEffectiveAiMode(studentId, assignmentId)).toBe("PROTECTED_ASSESSMENT");
    const view = await getAssignmentForStudent(student, assignmentId);
    expect(view!.progressStatus).toBe("SUBMITTED");
    expect(JSON.stringify(view)).not.toContain(REF_SOLUTION);
  });

  it("grades with ALL tests; weighted deterministic score is FINAL", async () => {
    const r = await gradeSubmission(firstId);
    expect(r.status).toBe("FINAL");
    const g = await prisma.grade.findUniqueOrThrow({
      where: { submissionId_scopeKey: { submissionId: firstId, scopeKey: questionId } },
    });
    // weights: public pass (1) + hidden fail (3) -> 1/4 of 10
    expect(g.rawPoints).toBe(2.5);
    expect(g.finalScore).toBe(2.5);
    expect(g.testsTotal).toBe(2);
    expect(JSON.stringify(g.gradingResults)).toContain(HIDDEN_NAME);
    expect(
      await prisma.analyticsEvent.count({
        where: { assignmentId, eventName: "deterministic_grade_completed" },
      }),
    ).toBe(1);
    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: firstId } });
    expect(sub.status).toBe("GRADED");
    // regrading does not duplicate events or change the result
    await gradeSubmission(firstId);
    expect(
      await prisma.analyticsEvent.count({
        where: { assignmentId, eventName: "deterministic_grade_completed" },
      }),
    ).toBe(1);
  });

  it("runner down: submission succeeded, grade is PENDING_RUNNER and retryable", async () => {
    const other = await prisma.user.create({
      data: {
        email: `stu2-${RUN}@socra.local`,
        name: "S2",
        roles: ["STUDENT"],
        memberships: { create: { courseId, role: "STUDENT" } },
      },
    });
    const s2 = (await loadPrincipal(other.id, `s2-${RUN}`))!;
    const sub = await createSubmission(s2, {
      assignmentId,
      idempotencyKey: `idem-${RUN}-s2`,
      answers: [{ questionId, content: "code" }],
    });
    setCodeRunnerForTests(fakeRunner(true));
    const r = await gradeSubmission(sub.submissionId);
    expect(r.status).toBe("PENDING");
    const g = await prisma.grade.findUniqueOrThrow({
      where: { submissionId_scopeKey: { submissionId: sub.submissionId, scopeKey: questionId } },
    });
    expect(g.status).toBe("PENDING");
    expect(g.rawPoints).toBeNull();
    expect((g.gradingResults as { pending?: string }).pending).toBe("PENDING_RUNNER");
    setCodeRunnerForTests(fakeRunner());
    expect((await gradeSubmission(sub.submissionId)).status).toBe("FINAL");
  });

  it("finalize with an override requires a reason and is audited", async () => {
    await expect(
      finalizeGrade(faculty, firstId, { questions: [{ questionId, points: 8 }] }),
    ).rejects.toMatchObject({ code: "override_reason_required" });
    await expect(
      finalizeGrade(student, firstId, {
        questions: [{ questionId, points: 8, overrideReason: "because" }],
      }),
    ).rejects.toThrow();
    const done = await finalizeGrade(faculty, firstId, {
      questions: [{ questionId, points: 8, overrideReason: "Hidden test 2 was mis-specified" }],
    });
    expect(done.finalScore).toBe(8);
    expect(done.overridden).toBe(true);
    const g = await prisma.grade.findUniqueOrThrow({
      where: { submissionId_scopeKey: { submissionId: firstId, scopeKey: questionId } },
    });
    expect(g.facultyOverride).toBe(8);
    expect(g.status).toBe("FINAL");
    expect(g.graderType).toBe("INSTRUCTOR");
    const audits = await prisma.gradeOverrideAudit.findMany({ where: { gradeId: g.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ previousScore: 2.5, newScore: 8 });
    expect(
      await prisma.auditLog.count({ where: { action: "grade.override", targetId: g.id } }),
    ).toBe(1);
    expect(
      await prisma.analyticsEvent.count({
        where: { assignmentId, eventName: "faculty_grade_finalized" },
      }),
    ).toBe(1);
  });
});

describe("close, release and reopen", () => {
  it("closing keeps protected mode until solutions are released; submissions are rejected", async () => {
    await closeAssignment(faculty, assignmentId);
    expect(await getEffectiveAiMode(studentId, assignmentId)).toBe("PROTECTED_ASSESSMENT");
    await expect(
      createSubmission(student, {
        assignmentId,
        idempotencyKey: `idem-${RUN}-late`,
        answers: [{ questionId, content: "x" }],
      }),
    ).rejects.toMatchObject({ code: "assignment_closed" });
    expect(
      await prisma.auditLog.count({
        where: { action: "assignment.close", targetId: assignmentId },
      }),
    ).toBe(1);
  });

  it("release moves students to POST_ASSESSMENT_REVIEW and exposes the reference solution", async () => {
    await releaseSolutions(faculty, assignmentId);
    expect(await getEffectiveAiMode(studentId, assignmentId)).toBe("POST_ASSESSMENT_REVIEW");
    const view = await getAssignmentForStudent(student, assignmentId);
    expect(view!.mode).toBe("POST_ASSESSMENT_REVIEW");
    expect(view!.questions[0]!.referenceSolution).toBe(REF_SOLUTION);
    expect(JSON.stringify(view)).not.toContain(HIDDEN_NAME);
    const ctx = await getWorkspaceContextForAi(studentId, assignmentId);
    expect(ctx.mode).toBe("POST_ASSESSMENT_REVIEW");
    expect(ctx.assignment.referenceSolution).toBe(REF_SOLUTION);
    expect(
      await prisma.auditLog.count({
        where: { action: "assignment.solutions_release", targetId: assignmentId },
      }),
    ).toBe(1);
  });

  it("reopen needs a reason, is audited, and revokes the release", async () => {
    await expect(reopenAssignment(faculty, assignmentId, { reason: "" })).rejects.toThrow();
    await expect(
      reopenAssignment(student, assignmentId, { reason: "let me in please" }),
    ).rejects.toThrow();
    await reopenAssignment(faculty, assignmentId, {
      reason: "Extension granted for outage",
      closeAt: null,
    });
    expect(await getEffectiveAiMode(studentId, assignmentId)).toBe("PROTECTED_ASSESSMENT");
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.state).toBe("PUBLISHED_PROTECTED");
    expect(a.solutionsReleased).toBe(false);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "assignment.reopen", targetId: assignmentId },
    });
    expect(audit?.reason).toContain("Extension");
  });
});
