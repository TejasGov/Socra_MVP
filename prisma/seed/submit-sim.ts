import { sid } from "./context";
import { WRITTEN_ANSWERS } from "./data/dialogues";
import { addEvidence } from "./evidence";
import { type Episode } from "./coding-sim";
import { clampAt, pFirst, sigmoid, skillFor, type Acc, type CourseKey, type Student } from "./sim";
import { clamp, DAY_MS, HOUR_MS, intBetween, S, sha, type AssignmentRef } from "./state";

export interface StaffIds {
  faculty: string;
  ta: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

interface CommonArgs {
  acc: Acc;
  st: Student;
  asg: AssignmentRef;
  courseKey: CourseKey;
  r: () => number;
  staff: StaffIds;
  openedAt: number;
}

function sectionOf(st: Student, courseKey: CourseKey) {
  return st.section[courseKey] ? sid("section", courseKey, st.section[courseKey] as string) : null;
}

function upsertProgress(
  a: CommonArgs,
  attemptNo: number,
  subId: string,
  at: number,
  returnedAt: Date | null,
) {
  a.acc.progress.set(`${a.st.id}:${a.asg.id}`, {
    id: sid("prog", a.st.key, a.asg.courseKey, a.asg.key),
    userId: a.st.id,
    assignmentId: a.asg.id,
    status: returnedAt ? "RETURNED" : "SUBMITTED",
    attemptsUsed: attemptNo,
    latestSubmissionId: subId,
    firstOpenedAt: clampAt(a.openedAt),
    lastActivityAt: clampAt(at),
    submittedAt: clampAt(at),
    returnedAt,
  });
}

export function recordCodingSubmission(
  a: CommonArgs & { eps: Episode[]; attemptNo: number; at: number; late: boolean },
): { submissionId: string } {
  const { acc, st, asg, courseKey } = a;
  const submissionId = sid("sub", st.key, asg.courseKey, asg.key, a.attemptNo);
  const at = clampAt(a.at);
  const gradedAt = clampAt(a.at + intBetween(a.r, 18, 50) * 1000);
  const closedReturned = asg.def.closed ? new Date((asg.dueAt as Date).getTime() + DAY_MS) : null;
  const answersSnap = a.eps.map((e) => ({
    questionId: e.q.id,
    questionVersionId: e.q.versionId,
    content: e.finalCode,
    language: e.q.def.language,
  }));
  const snapshot = { answers: answersSnap };
  const publicPassed = a.eps.reduce((s, e) => s + e.publicPassed, 0);
  const publicTotal = a.eps.reduce((s, e) => s + e.publicTotal, 0);
  const maxPoints = a.eps.reduce((s, e) => s + e.q.def.points, 0);
  const rawPoints = a.eps.reduce((s, e) => s + round1(e.finalFrac * e.q.def.points), 0);

  acc.submissions.push({
    id: submissionId,
    userId: st.id,
    assignmentId: asg.id,
    assignmentVersionId: asg.versionId,
    courseId: asg.courseId,
    attemptNumber: a.attemptNo,
    idempotencyKey: `seed-${submissionId}`,
    status: closedReturned ? "RETURNED" : "GRADED",
    snapshot,
    snapshotHash: sha(JSON.stringify(snapshot)),
    publicTestSummary: { passed: publicPassed, total: publicTotal },
    researchCondition: st.condition,
    policyVersion: 1,
    clientVersion: "0.1.0",
    isLate: a.late,
    submittedAt: at,
    gradedAt,
    returnedAt: closedReturned,
  });

  const evBase = {
    actorId: st.id,
    courseId: asg.courseId,
    sectionId: sectionOf(st, courseKey),
    assignmentId: asg.id,
    assignmentVersion: asg.version,
    condition: st.condition,
  };
  acc.events.add({
    ...evBase,
    name: "submission_started",
    key: `substart:${submissionId}`,
    at: new Date(at.getTime() - 12_000),
    metadata: { attemptNumber: a.attemptNo },
  });
  const submittedEvent = acc.events.add({
    ...evBase,
    name: "submission_completed",
    key: `subdone:${submissionId}`,
    at,
    metadata: {
      submissionId,
      attemptNumber: a.attemptNo,
      snapshotHash: sha(JSON.stringify(snapshot)).slice(0, 16),
      isLate: a.late,
    },
  });

  const rubricIdFor = (qKey: string) => sid("rub", asg.courseKey, asg.key, qKey);
  a.eps.forEach((e, i) => {
    const q = e.q;
    acc.answers.push({
      id: sid("ans", submissionId, q.def.key),
      submissionId,
      questionId: q.id,
      questionVersionId: q.versionId,
      content: e.finalCode,
      language: q.def.language,
      contentHash: sha(e.finalCode),
    });
    const points = round1(e.finalFrac * q.def.points);
    acc.grades.push({
      id: sid("grade", submissionId, q.def.key),
      submissionId,
      questionId: q.id,
      scope: "QUESTION",
      scopeKey: q.id,
      rawPoints: points,
      maxPoints: q.def.points,
      method: "DETERMINISTIC_TESTS",
      graderType: "SYSTEM",
      status: "FINAL",
      finalScore: points,
      testsPassed: e.testsPassed,
      testsTotal: e.testsTotal,
      gradingResults: {
        tests: q.def.tests.map((t) => ({
          id: t.id,
          name: t.name,
          visibility: t.visibility,
          weight: t.weight,
          passed: !e.finalVariant.failing.includes(t.id) && !e.finalVariant.synthetic,
        })),
        runnerDriver: "docker",
      },
      rubricId: rubricIdFor(q.def.key),
      rubricVersion: 1,
      graderId: null,
      gradedAt,
      releasedAt: closedReturned,
      createdAt: gradedAt,
      updatedAt: gradedAt,
    });
    // official GRADING run for this question
    const runId = sid("run", st.key, asg.courseKey, asg.key, q.def.key, a.attemptNo, "grading");
    acc.runs.push({
      id: runId,
      userId: st.id,
      courseId: asg.courseId,
      assignmentId: asg.id,
      questionId: q.id,
      submissionId,
      kind: "GRADING",
      language: q.def.language,
      status: e.finalVariant.err?.status === "TIMEOUT" ? "TIMEOUT" : "OK",
      codeSnapshot: e.finalCode,
      codeHash: sha(e.finalCode),
      stdout: "",
      stderr: e.finalVariant.err?.status === "TIMEOUT" ? e.finalVariant.err.text : "",
      exitCode: e.finalVariant.err?.status === "TIMEOUT" ? null : 0,
      durationMs: intBetween(a.r, 200, 900),
      testResults: q.def.tests
        .filter((t) => t.visibility === "PUBLIC")
        .map((t) => ({
          testId: t.id,
          name: t.name,
          visibility: "PUBLIC",
          passed: !e.finalVariant.failing.includes(t.id),
          weight: t.weight,
        })),
      testsPassed: e.testsPassed,
      testsTotal: e.testsTotal,
      runnerDriver: "docker",
      errorClass: e.finalVariant.err?.status === "TIMEOUT" ? "STUDENT_TIMEOUT" : null,
      jobId: runId,
      queuedAt: at,
      startedAt: new Date(at.getTime() + 300),
      completedAt: gradedAt,
    });
    void i;
    for (const topic of q.topicIds) {
      addEvidence({
        acc,
        st,
        courseKey,
        courseId: asg.courseId,
        topicId: topic.id,
        key: `${asg.key}:${q.def.key}:${a.attemptNo}:final`,
        type: "FINAL_CORRECTNESS",
        sourceType: "SUBMISSION",
        sourceId: submissionId,
        sourceEventId: submittedEvent,
        value: e.finalFrac,
        raw: { testsPassed: e.testsPassed, testsTotal: e.testsTotal },
        weight: topic.weight,
        assisted: Boolean(e.ai),
        maxLevel: e.ai?.maxLevel ?? null,
        difficulty: q.def.difficulty,
        attemptNumber: a.attemptNo,
        assignmentId: asg.id,
        assignmentVersion: asg.version,
        questionId: q.id,
        aiSessionId: e.ai?.sessionId ?? null,
        at: new Date(gradedAt.getTime() + 1000),
        condition: st.condition,
      });
    }
  });
  acc.grades.push({
    id: sid("grade", submissionId, "overall"),
    submissionId,
    questionId: null,
    scope: "SUBMISSION",
    scopeKey: "overall",
    rawPoints,
    maxPoints,
    method: "DETERMINISTIC_TESTS",
    graderType: "SYSTEM",
    status: "FINAL",
    finalScore: rawPoints,
    testsPassed: a.eps.reduce((s, e) => s + e.testsPassed, 0),
    testsTotal: a.eps.reduce((s, e) => s + e.testsTotal, 0),
    gradedAt,
    releasedAt: closedReturned,
    createdAt: gradedAt,
    updatedAt: gradedAt,
  });
  acc.events.add({
    ...evBase,
    name: "deterministic_grade_completed",
    key: `detgrade:${submissionId}`,
    at: gradedAt,
    metadata: {
      submissionId,
      score: rawPoints,
      maxScore: maxPoints,
      testsPassed: a.eps.reduce((s, e) => s + e.testsPassed, 0),
      testsTotal: a.eps.reduce((s, e) => s + e.testsTotal, 0),
    },
  });
  upsertProgress(a, a.attemptNo, submissionId, a.at, closedReturned);
  return { submissionId };
}

// --------------------------------------------------------------------------------------------------------------
// Quiz (auto-graded + written answers)
// --------------------------------------------------------------------------------------------------------------

const WRONG_Q1 = ["5", "3", "7", "0", "9"];

export function simulateQuiz(a: CommonArgs & { t0: number }): void {
  const { acc, st, asg, courseKey, r, staff } = a;
  const [q1, q2, q3] = asg.questions;
  if (!q1 || !q2 || !q3) return;
  const evBase = {
    actorId: st.id,
    courseId: asg.courseId,
    sectionId: sectionOf(st, courseKey),
    assignmentId: asg.id,
    assignmentVersion: asg.version,
    condition: st.condition,
  };
  let t = a.t0;

  const s1 = skillFor(st, q1.def.topics);
  const s2 = skillFor(st, q2.def.topics);
  const s3 = skillFor(st, q3.def.topics);
  const ok1 = r() < pFirst(s1, 2) + 0.1;
  const ok2 = r() < pFirst(s2, 2) + 0.1;
  const a1 = ok1 ? "6" : (WRONG_Q1[Math.floor(r() * WRONG_Q1.length)] as string);
  const a2 = ok2 ? "b" : (["a", "c", "d"][Math.floor(r() * 3)] as string);
  const pGood = sigmoid(5 * (s3 - 0.5));
  const u = r();
  const level: "good" | "partial" | "weak" =
    u < pGood ? "good" : u < pGood + (1 - pGood) * 0.7 ? "partial" : "weak";
  const pool = WRITTEN_ANSWERS[level];
  const a3 = pool[Math.floor(r() * pool.length)] as string;
  const answers = [
    { q: q1, content: a1 },
    { q: q2, content: a2 },
    { q: q3, content: a3 },
  ];

  // drafts + events while answering
  answers.forEach(({ q, content }, i) => {
    t += intBetween(r, 90, 420) * 1000;
    acc.events.add({
      ...evBase,
      name: "question_viewed",
      key: `qview:${st.key}:${q.id}:1`,
      at: clampAt(t),
      questionId: q.id,
      questionVersion: 1,
      metadata: {},
    });
    const saves = i === 2 ? 3 : 1;
    for (let k = 1; k <= saves; k++) {
      t += intBetween(r, 30, 150) * 1000;
      const at = clampAt(t);
      acc.events.add({
        ...evBase,
        name: "draft_saved",
        key: `draft:${st.key}:${q.id}:1:${k}`,
        at,
        questionId: q.id,
        questionVersion: 1,
        metadata: {
          draftVersion: k,
          contentHash: sha(content).slice(0, 16),
          byteCount: Buffer.byteLength(content),
        },
      });
      acc.drafts.set(sid("draft", st.key, q.id), {
        id: sid("draft", st.key, q.id),
        userId: st.id,
        assignmentId: asg.id,
        questionId: q.id,
        content,
        language: null,
        version: k,
        contentHash: sha(content),
        clientUpdatedAt: at,
        createdAt: at,
        updatedAt: at,
      });
    }
  });

  t += intBetween(r, 60, 240) * 1000;
  const submissionId = sid("sub", st.key, asg.courseKey, asg.key, 1);
  const at = clampAt(t);
  const gradedAt = clampAt(t + 25_000);
  const late = asg.dueAt ? at.getTime() > asg.dueAt.getTime() : false;
  const snapshot = {
    answers: answers.map(({ q, content }) => ({
      questionId: q.id,
      questionVersionId: q.versionId,
      content,
      language: null,
    })),
  };
  const hash = sha(JSON.stringify(snapshot));
  const ageFromAnchor = (S.anchor.getTime() - at.getTime()) / HOUR_MS;
  const finalizeWritten = ageFromAnchor > 14 && r() < 0.8;

  acc.events.add({
    ...evBase,
    name: "submission_started",
    key: `substart:${submissionId}`,
    at: new Date(at.getTime() - 10_000),
    metadata: { attemptNumber: 1 },
  });
  const submittedEvent = acc.events.add({
    ...evBase,
    name: "submission_completed",
    key: `subdone:${submissionId}`,
    at,
    metadata: { submissionId, attemptNumber: 1, snapshotHash: hash.slice(0, 16), isLate: late },
  });

  // auto-graded questions
  const auto = [
    { q: q1, content: a1, ok: ok1 },
    { q: q2, content: a2, ok: ok2 },
  ];
  let autoPoints = 0;
  for (const x of auto) {
    const pts = x.ok ? x.q.def.points : 0;
    autoPoints += pts;
    acc.grades.push({
      id: sid("grade", submissionId, x.q.def.key),
      submissionId,
      questionId: x.q.id,
      scope: "QUESTION",
      scopeKey: x.q.id,
      rawPoints: pts,
      maxPoints: x.q.def.points,
      method: "DETERMINISTIC_TESTS",
      graderType: "SYSTEM",
      status: "FINAL",
      finalScore: pts,
      gradingResults: { answerKeyMatched: x.ok },
      rubricId: sid("rub", asg.courseKey, asg.key, x.q.def.key),
      rubricVersion: 1,
      gradedAt,
      createdAt: gradedAt,
      updatedAt: gradedAt,
    });
    for (const topic of x.q.topicIds) {
      for (const type of ["FIRST_ATTEMPT_CORRECTNESS", "FINAL_CORRECTNESS"] as const) {
        addEvidence({
          acc,
          st,
          courseKey,
          courseId: asg.courseId,
          topicId: topic.id,
          key: `${asg.key}:${x.q.def.key}:${type}`,
          type,
          sourceType: "SUBMISSION",
          sourceId: submissionId,
          sourceEventId: submittedEvent,
          value: x.ok ? 1 : 0,
          raw: { correct: x.ok },
          weight: topic.weight,
          difficulty: x.q.def.difficulty,
          attemptNumber: 1,
          assignmentId: asg.id,
          assignmentVersion: asg.version,
          questionId: x.q.id,
          at: new Date(gradedAt.getTime() + 1000),
          condition: st.condition,
        });
      }
    }
  }

  // written answer: AI suggestion, then faculty finalization for older submissions
  const crit = q3.def.rubric;
  const patterns: Record<typeof level, number[][]> = {
    good: [
      [2, 2, 2],
      [2, 2, 1],
      [2, 2, 2],
    ],
    partial: [
      [2, 1, 0],
      [1, 1, 1],
      [1, 2, 0],
      [2, 1, 1],
    ],
    weak: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  };
  const pat = patterns[level][Math.floor(r() * patterns[level].length)] as number[];
  const aiScore = pat.reduce((s, x) => s + x, 0);
  const aiReqId = sid("aireq", "grade", submissionId);
  acc.aiRequests.push({
    id: aiReqId,
    sessionId: null,
    userId: staff.faculty,
    courseId: asg.courseId,
    assignmentId: asg.id,
    questionId: q3.id,
    mode: "FACULTY_AUTHORING",
    task: "grading_suggestion",
    provider: "MOCK",
    model: "mock-socra-1",
    traceId: sid("trace", "grade", submissionId),
    promptTemplateId: "grading-suggestion",
    promptVersion: "grading-suggest-v1",
    policyVersion: null,
    assignmentVersion: asg.version,
    questionVersion: 1,
    researchCondition: null,
    status: "SUCCEEDED",
    latencyMs: intBetween(r, 900, 2800),
    firstTokenMs: intBetween(r, 300, 700),
    inputTokens: 820 + intBetween(r, 0, 200),
    cachedTokens: 400,
    outputTokens: 150 + intBetween(r, 0, 80),
    reasoningTokens: 0,
    costUsd: "0.000290",
    appVersion: "0.1.0",
    retrievedResourceIds: [],
    structuredOutputValid: true,
    retryCount: 0,
    fallbackUsed: false,
    routingReason: "tier:protected",
    createdAt: gradedAt,
    completedAt: new Date(gradedAt.getTime() + 1800),
  });
  const written = sid("grade", submissionId, q3.def.key);
  const criterionScores = crit.map((c, i) => ({
    criterion: c.title,
    points: pat[i] as number,
    maxPoints: c.maxPoints,
  }));
  const feedbackByLevel = {
    good: "Clear explanation of infinite recursion, the growing call stack and the role of a base case.",
    partial:
      "You describe what happens, but the answer is missing at least one of: the call stack growing until it overflows, or what the base case would do.",
    weak: "The answer does not yet explain why the function never stops. Reread the lecture section on base cases.",
  } as const;
  const aiSuggestion = {
    score: aiScore,
    criterionScores,
    feedback: feedbackByLevel[level],
    model: "mock-socra-1",
    promptVersion: "grading-suggest-v1",
    aiRequestId: aiReqId,
  };
  acc.events.add({
    ...evBase,
    name: "ai_feedback_generated",
    key: `aifb:${submissionId}`,
    at: new Date(gradedAt.getTime() + 2500),
    metadata: { submissionId, gradeId: written, aiRequestId: aiReqId },
  });
  let writtenPoints = aiScore;
  if (finalizeWritten) {
    const adjust = r() < 0.2 ? (aiScore >= 5 ? -1 : 1) : 0;
    const finalPts = clamp(aiScore + adjust, 0, q3.def.points);
    writtenPoints = finalPts;
    const grader = r() < 0.7 ? staff.faculty : staff.ta;
    const gAt = clampAt(at.getTime() + intBetween(r, 15, 40) * HOUR_MS);
    acc.grades.push({
      id: written,
      submissionId,
      questionId: q3.id,
      scope: "QUESTION",
      scopeKey: q3.id,
      rawPoints: aiScore,
      maxPoints: q3.def.points,
      method: "MIXED",
      graderType: grader === staff.faculty ? "INSTRUCTOR" : "TA",
      status: "FINAL",
      aiSuggestion,
      facultyOverride: adjust !== 0 ? finalPts : null,
      finalScore: finalPts,
      feedback: feedbackByLevel[level],
      criterionScores,
      rubricId: sid("rub", asg.courseKey, asg.key, q3.def.key),
      rubricVersion: 1,
      graderId: grader,
      gradedAt: gAt,
      createdAt: gradedAt,
      updatedAt: gAt,
    });
    if (adjust !== 0) {
      acc.overrides.push({
        id: sid("gov", written),
        gradeId: written,
        actorId: grader,
        previousScore: aiScore,
        newScore: finalPts,
        reason:
          adjust > 0
            ? "Answer mentions the stack growing; credited the second criterion."
            : "Answer is less specific than the AI suggestion implied.",
        createdAt: gAt,
      });
    }
    acc.events.add({
      ...evBase,
      actorId: grader,
      condition: null,
      name: "faculty_grade_finalized",
      key: `facfinal:${written}`,
      at: gAt,
      metadata: {
        submissionId,
        gradeId: written,
        score: finalPts,
        maxScore: q3.def.points,
        rubricVersion: 1,
        graderType: grader === staff.faculty ? "INSTRUCTOR" : "TA",
        overridden: adjust !== 0,
      },
    });
    for (const topic of q3.topicIds) {
      addEvidence({
        acc,
        st,
        courseKey,
        courseId: asg.courseId,
        topicId: topic.id,
        key: `${asg.key}:${q3.def.key}:final`,
        type: "FINAL_CORRECTNESS",
        sourceType: "GRADE",
        sourceId: written,
        sourceEventId: submittedEvent,
        value: finalPts / q3.def.points,
        raw: { points: finalPts, maxPoints: q3.def.points },
        weight: topic.weight,
        difficulty: q3.def.difficulty,
        attemptNumber: 1,
        assignmentId: asg.id,
        assignmentVersion: asg.version,
        questionId: q3.id,
        at: new Date(gAt.getTime() + 1000),
        condition: st.condition,
      });
    }
  } else {
    acc.grades.push({
      id: written,
      submissionId,
      questionId: q3.id,
      scope: "QUESTION",
      scopeKey: q3.id,
      rawPoints: aiScore,
      maxPoints: q3.def.points,
      method: "AI_SUGGESTED_RUBRIC",
      graderType: "AI",
      status: "SUGGESTED",
      aiSuggestion,
      criterionScores,
      rubricId: sid("rub", asg.courseKey, asg.key, q3.def.key),
      rubricVersion: 1,
      gradedAt: null,
      createdAt: gradedAt,
      updatedAt: gradedAt,
    });
  }

  const maxPoints = q1.def.points + q2.def.points + q3.def.points;
  const overall = autoPoints + writtenPoints;
  acc.grades.push({
    id: sid("grade", submissionId, "overall"),
    submissionId,
    questionId: null,
    scope: "SUBMISSION",
    scopeKey: "overall",
    rawPoints: overall,
    maxPoints,
    method: "MIXED",
    graderType: "SYSTEM",
    status: finalizeWritten ? "FINAL" : "SUGGESTED",
    finalScore: finalizeWritten ? overall : null,
    gradedAt: finalizeWritten ? gradedAt : null,
    createdAt: gradedAt,
    updatedAt: gradedAt,
  });
  acc.events.add({
    ...evBase,
    name: "deterministic_grade_completed",
    key: `detgrade:${submissionId}`,
    at: gradedAt,
    metadata: {
      submissionId,
      score: autoPoints,
      maxScore: q1.def.points + q2.def.points,
      testsPassed: Number(ok1) + Number(ok2),
      testsTotal: 2,
    },
  });
  acc.submissions.push({
    id: submissionId,
    userId: st.id,
    assignmentId: asg.id,
    assignmentVersionId: asg.versionId,
    courseId: asg.courseId,
    attemptNumber: 1,
    idempotencyKey: `seed-${submissionId}`,
    status: finalizeWritten ? "GRADED" : "GRADING",
    snapshot,
    snapshotHash: hash,
    publicTestSummary: { passed: Number(ok1) + Number(ok2), total: 2 },
    researchCondition: st.condition,
    policyVersion: 1,
    clientVersion: "0.1.0",
    isLate: late,
    submittedAt: at,
    gradedAt: finalizeWritten ? gradedAt : null,
  });
  for (const x of answers) {
    acc.answers.push({
      id: sid("ans", submissionId, x.q.def.key),
      submissionId,
      questionId: x.q.id,
      questionVersionId: x.q.versionId,
      content: x.content,
      language: null,
      contentHash: sha(x.content),
    });
  }
  upsertProgress(a, 1, submissionId, t, null);
}
