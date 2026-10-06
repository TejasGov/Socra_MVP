import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectPrisma, prisma } from "@/server/db";
import { clearConsumers } from "@/server/events/consumers/registry";
import { registerLearningConsumers } from "@/server/events/consumers/learning-evidence";
import { drainOutbox } from "@/server/events/dispatcher";
import { writeEvent } from "@/server/events/outbox";
import { recomputeAllTopicStates, recomputeTopicStates } from "@/server/domain/learner";
import { recordMisconceptionObservation } from "@/server/domain/misconceptions";
import { recomputeAggregates } from "@/server/domain/analytics";

/**
 * Learning-evidence pipeline end to end: events -> consumers -> LearningEvidence -> LearnerTopicState,
 * idempotency under replay, misconception mapping, and aggregation over the result.
 */

const RUN = randomUUID().slice(0, 8);
const ids: Record<string, string> = {};
const T = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

async function submit(
  userId: string,
  attemptNumber: number,
  points: number,
  submittedAt: Date,
  contentHash: string,
) {
  const sub = await prisma.submission.create({
    data: {
      userId,
      assignmentId: ids.assignment!,
      assignmentVersionId: ids.assignmentVersion!,
      courseId: ids.course!,
      attemptNumber,
      idempotencyKey: `itest-${RUN}-${userId}-${attemptNumber}`,
      snapshot: {},
      snapshotHash: contentHash,
      submittedAt,
      status: "GRADED",
      answers: {
        create: [
          {
            questionId: ids.question!,
            questionVersionId: ids.questionVersion!,
            content: "def f(n): ...",
            contentHash,
          },
        ],
      },
      grades: {
        create: [
          {
            questionId: ids.question!,
            scope: "QUESTION",
            scopeKey: ids.question!,
            rawPoints: points,
            maxPoints: 10,
            method: "DETERMINISTIC_TESTS",
            graderType: "SYSTEM",
            status: "PENDING",
          },
        ],
      },
    },
  });
  await prisma.$transaction((tx) =>
    writeEvent(tx, {
      eventName: "deterministic_grade_completed",
      actorId: userId,
      courseId: ids.course!,
      assignmentId: ids.assignment!,
      assignmentVersion: 1,
      questionId: ids.question!,
      occurredAt: submittedAt,
      idempotencyKey: `dgc:${sub.id}`,
      researchCondition: null,
      metadata: {
        submissionId: sub.id,
        score: points,
        maxScore: 10,
        testsPassed: points,
        testsTotal: 10,
      },
    }),
  );
  return sub;
}

beforeAll(async () => {
  await prisma.outboxEvent.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
  clearConsumers();
  registerLearningConsumers();

  const faculty = await prisma.user.create({
    data: { email: `fac-${RUN}@itest.local`, name: "Faculty", roles: ["INSTRUCTOR"] },
  });
  const a = await prisma.user.create({ data: { email: `a-${RUN}@itest.local`, name: "A" } });
  const b = await prisma.user.create({ data: { email: `b-${RUN}@itest.local`, name: "B" } });
  const course = await prisma.course.create({
    data: { code: `IT ${RUN}`, title: "Integration", term: "Test", languages: ["PYTHON"] },
  });
  await prisma.courseMembership.createMany({
    data: [
      { userId: faculty.id, courseId: course.id, role: "INSTRUCTOR" },
      { userId: a.id, courseId: course.id, role: "STUDENT" },
      { userId: b.id, courseId: course.id, role: "STUDENT" },
    ],
  });
  const topic = await prisma.topic.create({
    data: { courseId: course.id, key: "recursion-base-cases", name: "Recursive base cases" },
  });
  const assignment = await prisma.assignment.create({
    data: {
      courseId: course.id,
      title: "Recursion lab",
      format: "CODING",
      state: "PUBLISHED_PROTECTED",
      createdById: faculty.id,
    },
  });
  const av = await prisma.assignmentVersion.create({
    data: {
      assignmentId: assignment.id,
      version: 1,
      snapshot: {},
      snapshotHash: "x",
      createdById: faculty.id,
    },
  });
  const question = await prisma.question.create({ data: { assignmentId: assignment.id } });
  const qv = await prisma.questionVersion.create({
    data: {
      questionId: question.id,
      version: 1,
      title: "Q1",
      prompt: "Write f",
      type: "CODING",
      points: 10,
    },
  });
  await prisma.questionTopic.create({ data: { questionId: question.id, topicId: topic.id } });
  await prisma.misconception.create({
    data: {
      courseId: course.id,
      topicId: topic.id,
      key: "base-case-unreachable",
      label: "Assumes every decreasing sequence reaches the base case",
      description: "d",
    },
  });
  Object.assign(ids, {
    faculty: faculty.id,
    a: a.id,
    b: b.id,
    course: course.id,
    topic: topic.id,
    assignment: assignment.id,
    assignmentVersion: av.id,
    question: question.id,
    questionVersion: qv.id,
  });
});

afterAll(async () => {
  clearConsumers();
  await disconnectPrisma();
});

describe("learning evidence pipeline", () => {
  it("distinguishes independent first-try success from assisted success after retries", async () => {
    // Student A: 100%, first try, no Socra.
    await submit(ids.a!, 1, 10, T(60), "a1");

    // Student B: first attempt fails, then six deep hints (up to L5), then 100% on retry.
    await submit(ids.b!, 1, 2, T(120), "b1");
    const session = await prisma.aiSession.create({
      data: {
        userId: ids.b!,
        courseId: ids.course!,
        mode: "PROTECTED_ASSESSMENT",
        assignmentId: ids.assignment!,
        questionId: ids.question!,
        startedAt: T(100),
        maxInterventionLevel: 5,
      },
    });
    for (const [i, level] of [1, 2, 3, 4, 5, 5].entries()) {
      await prisma.aiMessage.create({
        data: {
          sessionId: session.id,
          role: "ASSISTANT",
          content: "hint",
          interventionLevel: level,
          createdAt: T(99 - i),
        },
      });
    }
    await submit(ids.b!, 2, 10, T(30), "b2");

    const summary = await drainOutbox();
    expect(summary.failed).toBe(0);

    const evA = await prisma.learningEvidence.findMany({
      where: { userId: ids.a!, invalidatedAt: null },
    });
    const evB = await prisma.learningEvidence.findMany({
      where: { userId: ids.b!, invalidatedAt: null },
    });
    expect(evA.map((e) => e.evidenceType)).toEqual(["FIRST_ATTEMPT_CORRECTNESS"]);
    expect(evA[0]).toMatchObject({ value: 1, assisted: false, maxInterventionLevel: 0, weight: 1 });

    const types = evB.map((e) => e.evidenceType).sort();
    expect(types).toEqual(
      [
        "FINAL_CORRECTNESS",
        "FIRST_ATTEMPT_CORRECTNESS",
        "RECOVERY_AFTER_GUIDANCE",
        "RETRY_IMPROVEMENT",
      ].sort(),
    );
    const finalB = evB.find((e) => e.evidenceType === "FINAL_CORRECTNESS")!;
    expect(finalB).toMatchObject({ value: 1, assisted: true, maxInterventionLevel: 5 });
    expect(finalB.weight).toBeCloseTo(0.7 * 0.4, 6);
    expect((finalB.rawValue as { hintCount: number }).hintCount).toBe(6);

    const [stateA, stateB] = await Promise.all([
      prisma.learnerTopicState.findUnique({
        where: { userId_topicId: { userId: ids.a!, topicId: ids.topic! } },
      }),
      prisma.learnerTopicState.findUnique({
        where: { userId_topicId: { userId: ids.b!, topicId: ids.topic! } },
      }),
    ]);
    expect(stateA?.algorithmVersion).toBe("ltm-v1");
    expect(stateA!.score).toBeGreaterThan(stateB!.score);
    expect(
      await prisma.analyticsEvent.count({
        where: { eventName: "learner_topic_state_changed", actorId: { in: [ids.a!, ids.b!] } },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent: replaying events and re-delivering a duplicate do not add evidence", async () => {
    const before = await prisma.learningEvidence.count({ where: { courseId: ids.course! } });
    // Re-deliver every processed event for this course (simulates at-least-once redelivery after a crash).
    const events = await prisma.analyticsEvent.findMany({
      where: { courseId: ids.course!, eventName: "deterministic_grade_completed" },
      select: { id: true },
    });
    await prisma.processedEvent.deleteMany({ where: { eventId: { in: events.map((e) => e.id) } } });
    await prisma.outboxEvent.updateMany({
      where: { eventId: { in: events.map((e) => e.id) } },
      data: { status: "PENDING", availableAt: new Date(0) },
    });
    await drainOutbox();
    // A second event for the same submission (e.g. submission_completed after grading) converges on the same rows.
    const sub = await prisma.submission.findFirstOrThrow({ where: { userId: ids.a! } });
    await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "submission_completed",
        actorId: ids.a!,
        courseId: ids.course!,
        assignmentId: ids.assignment!,
        assignmentVersion: 1,
        idempotencyKey: `sc:${sub.id}`,
        researchCondition: null,
        metadata: { submissionId: sub.id, attemptNumber: 1, snapshotHash: "a1" },
      }),
    );
    await drainOutbox();
    expect(await prisma.learningEvidence.count({ where: { courseId: ids.course! } })).toBe(before);
  });

  it("rebuilds the same state from evidence", async () => {
    const before = await prisma.learnerTopicState.findMany({
      where: { courseId: ids.course! },
      orderBy: { userId: "asc" },
    });
    await prisma.learnerTopicState.deleteMany({ where: { courseId: ids.course! } });
    for (const s of before)
      await recomputeTopicStates(s.userId, ids.course!, {
        asOf: s.computedAsOf,
        emitEvents: false,
      });
    const after = await prisma.learnerTopicState.findMany({
      where: { courseId: ids.course! },
      orderBy: { userId: "asc" },
    });
    expect(after.map((s) => [s.state, s.score, s.evidenceCount])).toEqual(
      before.map((s) => [s.state, s.score, s.evidenceCount]),
    );
    const all = await recomputeAllTopicStates({ emitEvents: false });
    expect(all.pairs).toBeGreaterThanOrEqual(2);
  });

  it("maps misconception labels to canonical entries; unknown labels become PENDING candidates", async () => {
    const known = await prisma.$transaction((tx) =>
      recordMisconceptionObservation(tx, {
        userId: ids.b!,
        courseId: ids.course!,
        label: "assumes every decreasing sequence reaches the base case",
        confidence: 0.9,
        detectionMethod: "LLM",
        detectionVersion: "llm-extractor-v1",
        questionId: ids.question!,
        assignmentId: ids.assignment!,
        assignmentVersion: 1,
      }),
    );
    expect(known).toMatchObject({ ok: true, canonical: true });

    const unknown = await prisma.$transaction((tx) =>
      recordMisconceptionObservation(tx, {
        userId: ids.a!,
        courseId: ids.course!,
        label: "Thinks return prints the value",
        confidence: 0.8,
        detectionMethod: "LLM",
        detectionVersion: "llm-extractor-v1",
        questionId: ids.question!,
        assignmentId: ids.assignment!,
        assignmentVersion: 1,
      }),
    );
    expect(unknown).toMatchObject({ ok: true, canonical: false });
    const candidate = await prisma.misconception.findFirstOrThrow({
      where: { courseId: ids.course!, key: "thinks-return-prints-the-value" },
    });
    expect(candidate).toMatchObject({ reviewStatus: "PENDING", source: "AI_PROPOSED" });

    const malformed = await prisma.$transaction((tx) =>
      recordMisconceptionObservation(tx, { userId: ids.a!, courseId: ids.course!, confidence: 7 }),
    );
    expect(malformed.ok).toBe(false);

    await drainOutbox();
    const misEvidence = await prisma.learningEvidence.findMany({
      where: { courseId: ids.course!, evidenceType: "MISCONCEPTION_OBSERVED" },
    });
    expect(misEvidence).toHaveLength(1);
    expect(misEvidence[0]!.userId).toBe(ids.b);
    const stateB = await prisma.learnerTopicState.findUniqueOrThrow({
      where: { userId_topicId: { userId: ids.b!, topicId: ids.topic! } },
    });
    expect(stateB.commonDifficulty).toBe("Assumes every decreasing sequence reaches the base case");
  });

  it("aggregates without exposing candidates and with small-n suppression", async () => {
    const r = await recomputeAggregates(ids.course!);
    expect(r.rows).toBeGreaterThan(0);
    const first = await prisma.questionAggregate.findFirstOrThrow({
      where: { questionId: ids.question!, metricKey: "first_attempt_correctness" },
    });
    expect(first).toMatchObject({ numerator: 1, denominator: 2, suppressed: true, value: null });
    const recovery = await prisma.questionAggregate.findFirstOrThrow({
      where: { questionId: ids.question!, metricKey: "guided_recovery" },
    });
    expect(recovery).toMatchObject({ numerator: 1, denominator: 1 });
    const mis = await prisma.misconceptionAggregate.findMany({ where: { courseId: ids.course! } });
    const candidate = await prisma.misconception.findFirstOrThrow({
      where: { courseId: ids.course!, reviewStatus: "PENDING" },
    });
    expect(mis.some((m) => m.misconceptionId === candidate.id)).toBe(false);
  });
});
