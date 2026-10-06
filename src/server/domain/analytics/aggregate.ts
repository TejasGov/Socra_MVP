import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { gradeFraction } from "@/server/domain/learner/ingest";
import { independenceFactor, sourceFactor } from "@/server/domain/learner/topic-state";
import {
  ACTIVE_WINDOW_DAYS,
  CORRECT_FRACTION,
  METRIC_VERSION,
  MISCONCEPTION_MIN_CONFIDENCE,
  completion,
  finalCorrectness,
  firstAttemptCorrectness,
  funnel,
  guidedRecovery,
  interventionDepth,
  isoWeek,
  metric,
  misconceptionPrevalence,
  pct,
  retryCount,
  retryImprovement,
  topicDifficulty,
  unresolvedShare,
  type FunnelInput,
  type GradedAttempt,
  type StudentQuestionFact,
  type TopicOutcome,
} from "./metrics";
import type { MetricValue, RecomputeAggregatesResult, Recommendation } from "./types";

/**
 * Aggregation job (PRD §25.1): reads submissions, grades, learning evidence, topic states, misconception observations,
 * AiSession/AiMessage *metadata* (intervention levels and timestamps — never AiMessage.content) and AnalyticsEvent
 * rows, then rewrites the *Aggregate tables for each course in one transaction. Idempotent: rerunning on the same
 * data produces the same rows.
 */

const ANALYZED_STATES = ["PUBLISHED_PROTECTED", "CLOSED"] as const;
const WEEKS = 8;
const DAY_MS = 86_400_000;

type Row = {
  metricKey: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  sampleSize: number;
  suppressed: boolean;
  metric: Prisma.InputJsonValue;
  windowKey?: string;
  windowStart?: Date;
  windowEnd?: Date;
  segment?: string;
};

function mrow(metricKey: string, m: MetricValue, extra: Record<string, unknown> = {}): Row {
  return {
    metricKey,
    numerator: m.numerator,
    denominator: m.denominator,
    value: m.value,
    sampleSize: m.denominator,
    suppressed: m.suppressed,
    metric: { ...m, ...extra } as Prisma.InputJsonValue,
  };
}

function jrow(metricKey: string, payload: unknown, sampleSize = 0): Row {
  return {
    metricKey,
    numerator: null,
    denominator: null,
    value: null,
    sampleSize,
    suppressed: false,
    metric: payload as Prisma.InputJsonValue,
  };
}

export async function recomputeAggregates(courseId?: string): Promise<RecomputeAggregatesResult> {
  const started = Date.now();
  const courses = await prisma.course.findMany({
    where: courseId ? { id: courseId } : { isActive: true },
    select: { id: true },
  });
  let rows = 0;
  for (const c of courses) rows += await recomputeCourse(c.id);
  return { courses: courses.length, rows, durationMs: Date.now() - started };
}

async function recomputeCourse(courseId: string): Promise<number> {
  const threshold = env().ANALYTICS_SMALL_N_THRESHOLD;
  const timezone = env().ANALYTICS_TIMEZONE;
  const now = new Date();

  // ---------------------------------------------------------------- load
  const [course, memberships, assignments] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { id: true, timezone: true } }),
    prisma.courseMembership.findMany({
      where: { courseId, role: "STUDENT", status: "ACTIVE" },
      select: { userId: true },
    }),
    prisma.assignment.findMany({
      where: { courseId, state: { in: [...ANALYZED_STATES] } },
      select: {
        id: true,
        title: true,
        questions: { select: { id: true, topics: { select: { topicId: true } } } },
      },
    }),
  ]);
  if (!course) return 0;
  const students = new Set(memberships.map((m) => m.userId));
  const studentIds = [...students];
  const assignmentIds = assignments.map((a) => a.id);
  const questionToAssignment = new Map<string, string>();
  const questionTopics = new Map<string, string[]>();
  const assignmentQuestionCount = new Map<string, number>();
  for (const a of assignments) {
    assignmentQuestionCount.set(a.id, a.questions.length);
    for (const q of a.questions) {
      questionToAssignment.set(q.id, a.id);
      questionTopics.set(
        q.id,
        q.topics.map((t) => t.topicId),
      );
    }
  }

  const [
    submissions,
    sessions,
    events,
    topics,
    topicStates,
    evidence,
    observations,
    misconceptions,
  ] = await Promise.all([
    prisma.submission.findMany({
      where: { courseId, userId: { in: studentIds }, assignmentId: { in: assignmentIds } },
      select: {
        id: true,
        userId: true,
        assignmentId: true,
        attemptNumber: true,
        submittedAt: true,
        answers: { select: { questionId: true, contentHash: true } },
        grades: {
          select: {
            questionId: true,
            scope: true,
            status: true,
            method: true,
            graderType: true,
            rawPoints: true,
            finalScore: true,
            facultyOverride: true,
            maxPoints: true,
          },
        },
      },
      orderBy: { attemptNumber: "asc" },
    }),
    prisma.aiSession.findMany({
      where: { courseId, userId: { in: studentIds } },
      select: {
        id: true,
        userId: true,
        assignmentId: true,
        questionId: true,
        startedAt: true,
        maxInterventionLevel: true,
      },
    }),
    prisma.analyticsEvent.findMany({
      where: {
        courseId,
        status: "ACCEPTED",
        actorId: { in: studentIds },
        eventName: {
          in: [
            "assignment_opened",
            "question_viewed",
            "draft_saved",
            "answer_changed",
            "code_run_requested",
            "socra_session_started",
            "socra_prompt_sent",
            "submission_completed",
          ],
        },
      },
      select: {
        actorId: true,
        eventName: true,
        assignmentId: true,
        questionId: true,
        occurredAt: true,
      },
    }),
    prisma.topic.findMany({ where: { courseId }, select: { id: true } }),
    prisma.learnerTopicState.findMany({
      where: { courseId, userId: { in: studentIds } },
      select: { userId: true, topicId: true, state: true },
    }),
    prisma.learningEvidence.findMany({
      where: {
        courseId,
        userId: { in: studentIds },
        invalidatedAt: null,
        evidenceType: {
          in: [
            "FIRST_ATTEMPT_CORRECTNESS",
            "FINAL_CORRECTNESS",
            "RETRY_IMPROVEMENT",
            "PRACTICE_SUCCESS",
            "TRANSFER",
          ],
        },
      },
      select: {
        userId: true,
        topicId: true,
        evidenceType: true,
        sourceType: true,
        value: true,
        assisted: true,
        maxInterventionLevel: true,
      },
    }),
    prisma.misconceptionObservation.findMany({
      where: {
        courseId,
        userId: { in: studentIds },
        confidence: { gte: MISCONCEPTION_MIN_CONFIDENCE },
        misconception: { reviewStatus: "APPROVED" },
      },
      select: {
        userId: true,
        misconceptionId: true,
        questionId: true,
        detectionVersion: true,
      },
    }),
    prisma.misconception.findMany({
      where: { courseId, reviewStatus: "APPROVED" },
      select: { id: true, topicId: true },
    }),
  ]);

  // Intervention levels per session (metadata only; content is never selected).
  const messages = await prisma.aiMessage.findMany({
    where: {
      sessionId: { in: sessions.filter((s) => s.assignmentId).map((s) => s.id) },
      role: "ASSISTANT",
      interventionLevel: { not: null },
    },
    select: { sessionId: true, interventionLevel: true },
  });
  const sessionMaxLevel = new Map<string, number>();
  for (const m of messages) {
    sessionMaxLevel.set(
      m.sessionId,
      Math.max(sessionMaxLevel.get(m.sessionId) ?? 0, m.interventionLevel ?? 0),
    );
  }

  // ---------------------------------------------------------------- facts
  const facts = new Map<string, StudentQuestionFact>();
  const factKey = (u: string, q: string) => `${u}|${q}`;
  const getFact = (u: string, q: string): StudentQuestionFact => {
    const k = factKey(u, q);
    let f = facts.get(k);
    if (!f) {
      f = {
        userId: u,
        questionId: q,
        assignmentId: questionToAssignment.get(q)!,
        submitted: false,
        attempts: [],
        socraFirstAt: null,
        maxLevel: null,
        changedAfterSocra: false,
      };
      facts.set(k, f);
    }
    return f;
  };

  for (const s of submissions) {
    const qFractions = new Map<string, number>();
    for (const g of s.grades) {
      if (g.scope === "QUESTION" && g.questionId) {
        const fr = gradeFraction(g);
        if (fr !== null) qFractions.set(g.questionId, fr);
      }
    }
    if (qFractions.size === 0 && s.answers.length === 1) {
      const overall = s.grades.find((g) => g.scope === "SUBMISSION");
      const fr = overall ? gradeFraction(overall) : null;
      if (fr !== null) qFractions.set(s.answers[0]!.questionId, fr);
    }
    for (const a of s.answers) {
      if (!questionToAssignment.has(a.questionId)) continue;
      const f = getFact(s.userId, a.questionId);
      f.submitted = true;
      const fr = qFractions.get(a.questionId);
      if (fr !== undefined) {
        const attempt: GradedAttempt = {
          attemptNumber: s.attemptNumber,
          submittedAt: s.submittedAt,
          fraction: fr,
          contentHash: a.contentHash,
        };
        f.attempts.push(attempt);
      }
    }
  }
  for (const f of facts.values()) f.attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);

  /** Questions a session/event applies to: its question, else every question of a single-question assignment. */
  const questionsFor = (assignmentId: string | null, questionId: string | null): string[] => {
    if (questionId && questionToAssignment.has(questionId)) return [questionId];
    if (!assignmentId) return [];
    const a = assignments.find((x) => x.id === assignmentId);
    if (!a) return [];
    return a.questions.length === 1 ? [a.questions[0]!.id] : a.questions.map((q) => q.id);
  };

  const socraUsersAll = new Set<string>();
  for (const s of sessions) {
    socraUsersAll.add(s.userId);
    if (!s.assignmentId) continue;
    const level = sessionMaxLevel.get(s.id) ?? s.maxInterventionLevel;
    for (const q of questionsFor(s.assignmentId, s.questionId)) {
      const f = getFact(s.userId, q);
      f.maxLevel = Math.max(f.maxLevel ?? 0, level);
      if (!f.socraFirstAt || s.startedAt < f.socraFirstAt) f.socraFirstAt = s.startedAt;
    }
  }

  // Events by question for the funnel.
  type Ev = (typeof events)[number];
  const evByQuestion = new Map<string, Ev[]>();
  for (const e of events) {
    for (const q of questionsFor(e.assignmentId, e.questionId)) {
      const list = evByQuestion.get(q) ?? [];
      list.push(e);
      evByQuestion.set(q, list);
    }
  }
  const CHANGE = new Set(["draft_saved", "answer_changed"]);
  const ATTEMPT = new Set([
    "draft_saved",
    "answer_changed",
    "code_run_requested",
    "submission_completed",
  ]);
  const SOCRA = new Set(["socra_session_started", "socra_prompt_sent"]);

  const funnelInputs = new Map<string, FunnelInput>();
  for (const [q, list] of evByQuestion) {
    const viewed = list.filter((e) => e.eventName === "question_viewed");
    const opened = new Set(
      (viewed.length > 0 ? viewed : list.filter((e) => e.eventName === "assignment_opened")).map(
        (e) => e.actorId!,
      ),
    );
    const attempted = new Set(list.filter((e) => ATTEMPT.has(e.eventName)).map((e) => e.actorId!));
    const firstSocra = new Map<string, Date>();
    for (const e of list) {
      if (!SOCRA.has(e.eventName)) continue;
      const cur = firstSocra.get(e.actorId!);
      if (!cur || e.occurredAt < cur) firstSocra.set(e.actorId!, e.occurredAt);
    }
    const revised = new Set<string>();
    for (const e of list) {
      const t = firstSocra.get(e.actorId!);
      if (t && ATTEMPT.has(e.eventName) && e.occurredAt > t) revised.add(e.actorId!);
      if (t && CHANGE.has(e.eventName) && e.occurredAt > t) {
        const f = facts.get(factKey(e.actorId!, q));
        if (f) f.changedAfterSocra = true;
      }
    }
    const correctAfterRevision = new Set<string>();
    for (const u of revised) {
      const f = facts.get(factKey(u, q));
      const t = firstSocra.get(u)!;
      const after = f?.attempts.filter((a) => a.submittedAt > t) ?? [];
      if (after.length > 0 && after[after.length - 1]!.fraction >= CORRECT_FRACTION) {
        correctAfterRevision.add(u);
      }
    }
    // Submitters count as having attempted even if no work events were captured.
    for (const f of facts.values()) if (f.questionId === q && f.submitted) attempted.add(f.userId);
    funnelInputs.set(q, {
      opened,
      attempted,
      askedSocra: new Set(firstSocra.keys()),
      revised,
      correctAfterRevision,
    });
  }
  const emptyFunnel = (): FunnelInput => ({
    opened: new Set(),
    attempted: new Set(),
    askedSocra: new Set(),
    revised: new Set(),
    correctAfterRevision: new Set(),
  });

  const allFacts = [...facts.values()];
  const factsByQuestion = new Map<string, StudentQuestionFact[]>();
  for (const f of allFacts) {
    const list = factsByQuestion.get(f.questionId) ?? [];
    list.push(f);
    factsByQuestion.set(f.questionId, list);
  }

  // ---------------------------------------------------------------- question + assignment rows
  const questionRows: (Row & { questionId: string; assignmentId: string })[] = [];
  const assignmentRows: (Row & { assignmentId: string })[] = [];
  const completionByAssignment = new Map<string, number>();

  for (const a of assignments) {
    const aFacts = allFacts.filter((f) => f.assignmentId === a.id);
    const submitters = new Set(
      submissions.filter((s) => s.assignmentId === a.id).map((s) => s.userId),
    );
    completionByAssignment.set(a.id, submitters.size);
    // Assignment-level facts are per student (latest/first across questions would mix); we pool student-question tasks.
    const aFunnel = emptyFunnel();
    for (const q of a.questions) {
      const qFacts = factsByQuestion.get(q.id) ?? [];
      const submittedQ = qFacts.filter((f) => f.submitted).length;
      const fi = funnelInputs.get(q.id) ?? emptyFunnel();
      for (const k of Object.keys(aFunnel) as (keyof FunnelInput)[])
        for (const u of fi[k]) aFunnel[k].add(u);
      const base = { questionId: q.id, assignmentId: a.id };
      questionRows.push(
        {
          ...base,
          ...mrow("first_attempt_correctness", firstAttemptCorrectness(qFacts, threshold)),
        },
        { ...base, ...mrow("final_correctness", finalCorrectness(qFacts, threshold)) },
        { ...base, ...mrow("guided_recovery", guidedRecovery(qFacts, threshold)) },
        { ...base, ...mrow("retry_improvement", retryImprovement(qFacts, threshold)) },
        {
          ...base,
          ...(() => {
            const d = interventionDepth(qFacts, threshold);
            return mrow("intervention_depth", d, { max: d.max });
          })(),
        },
        { ...base, ...mrow("completion", completion(submittedQ, students.size, threshold)) },
        { ...base, ...jrow("completion_count", { count: submittedQ }, submittedQ) },
        { ...base, ...jrow("retry_count", { count: retryCount(qFacts) }, retryCount(qFacts)) },
        { ...base, ...jrow("funnel", { steps: funnel(fi) }, fi.opened.size) },
      );
    }
    const d = interventionDepth(aFacts, threshold);
    assignmentRows.push(
      {
        assignmentId: a.id,
        ...mrow("completion", completion(submitters.size, students.size, threshold)),
      },
      {
        assignmentId: a.id,
        ...mrow("first_attempt_correctness", firstAttemptCorrectness(aFacts, threshold)),
      },
      { assignmentId: a.id, ...mrow("final_correctness", finalCorrectness(aFacts, threshold)) },
      { assignmentId: a.id, ...mrow("guided_recovery", guidedRecovery(aFacts, threshold)) },
      { assignmentId: a.id, ...mrow("retry_improvement", retryImprovement(aFacts, threshold)) },
      { assignmentId: a.id, ...mrow("intervention_depth", d, { max: d.max }) },
      { assignmentId: a.id, ...jrow("funnel", { steps: funnel(aFunnel) }, aFunnel.opened.size) },
    );
  }

  // ---------------------------------------------------------------- topic rows
  const outcomesByTopic = new Map<string, TopicOutcome[]>();
  const evidenceStudentsByTopic = new Map<string, Set<string>>();
  for (const e of evidence) {
    const s = sourceFactor(e.evidenceType, e.sourceType);
    if (s === null) continue;
    const list = outcomesByTopic.get(e.topicId) ?? [];
    list.push({
      userId: e.userId,
      value: e.value,
      sourceFactor: s,
      independence: independenceFactor(e.maxInterventionLevel, e.assisted),
    });
    outcomesByTopic.set(e.topicId, list);
    const set = evidenceStudentsByTopic.get(e.topicId) ?? new Set<string>();
    set.add(e.userId);
    evidenceStudentsByTopic.set(e.topicId, set);
  }
  const statesByTopic = new Map<string, { state: string }[]>();
  for (const s of topicStates) {
    const list = statesByTopic.get(s.topicId) ?? [];
    list.push(s);
    statesByTopic.set(s.topicId, list);
  }
  const topicRows: (Row & { topicId: string })[] = [];
  const difficultyByTopic = new Map<string, MetricValue>();
  for (const t of topics) {
    const tFacts = allFacts.filter((f) => (questionTopics.get(f.questionId) ?? []).includes(t.id));
    const states = statesByTopic.get(t.id) ?? [];
    const diff = topicDifficulty(outcomesByTopic.get(t.id) ?? [], threshold);
    difficultyByTopic.set(t.id, diff);
    const count = (label: string) => states.filter((s) => s.state === label).length;
    const d = interventionDepth(tFacts, threshold);
    topicRows.push(
      { topicId: t.id, ...mrow("difficulty", diff) },
      { topicId: t.id, ...mrow("unresolved", unresolvedShare(states, threshold)) },
      {
        topicId: t.id,
        ...mrow(
          "state_needs_reinforcement",
          metric(count("NEEDS_REINFORCEMENT"), states.length, threshold),
        ),
      },
      {
        topicId: t.id,
        ...mrow("state_developing", metric(count("DEVELOPING"), states.length, threshold)),
      },
      {
        topicId: t.id,
        ...mrow(
          "state_consistently_demonstrated",
          metric(count("CONSISTENTLY_DEMONSTRATED"), states.length, threshold),
        ),
      },
      {
        topicId: t.id,
        ...mrow("first_attempt_correctness", firstAttemptCorrectness(tFacts, threshold)),
      },
      { topicId: t.id, ...mrow("final_correctness", finalCorrectness(tFacts, threshold)) },
      { topicId: t.id, ...mrow("intervention_depth", d, { max: d.max }) },
    );
  }

  // ---------------------------------------------------------------- misconception rows
  const misconceptionRows: (Row & {
    misconceptionId: string;
    topicId: string;
    assignmentId: string;
    detectorVersions: string[];
  })[] = [];
  const prevalenceByMisconception = new Map<string, MetricValue>();
  for (const m of misconceptions) {
    const obs = observations.filter((o) => o.misconceptionId === m.id);
    const versions = [...new Set(obs.map((o) => o.detectionVersion))].sort();
    const eligible = new Set([
      ...(evidenceStudentsByTopic.get(m.topicId) ?? []),
      ...obs.map((o) => o.userId),
    ]);
    const prev = misconceptionPrevalence(
      obs.map((o) => o.userId),
      eligible,
      threshold,
    );
    prevalenceByMisconception.set(m.id, prev);
    misconceptionRows.push({
      misconceptionId: m.id,
      topicId: m.topicId,
      assignmentId: "",
      detectorVersions: versions,
      ...mrow("prevalence", prev, { observationCount: obs.length }),
    });
    // Question-scoped prevalence (eligible = students who submitted the question).
    const byQuestion = new Map<string, typeof obs>();
    for (const o of obs) {
      if (!o.questionId || !questionToAssignment.has(o.questionId)) continue;
      const list = byQuestion.get(o.questionId) ?? [];
      list.push(o);
      byQuestion.set(o.questionId, list);
    }
    for (const [q, qObs] of byQuestion) {
      const submitters = (factsByQuestion.get(q) ?? [])
        .filter((f) => f.submitted)
        .map((f) => f.userId);
      const qEligible = new Set([...submitters, ...qObs.map((o) => o.userId)]);
      misconceptionRows.push({
        misconceptionId: m.id,
        topicId: m.topicId,
        assignmentId: questionToAssignment.get(q)!,
        detectorVersions: versions,
        ...mrow(
          "prevalence",
          misconceptionPrevalence(
            qObs.map((o) => o.userId),
            qEligible,
            threshold,
          ),
          {
            observationCount: qObs.length,
          },
        ),
        segment: `question:${q}`,
      });
    }
  }

  // ---------------------------------------------------------------- course rows
  const activeCutoff = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS);
  const activeActors = await prisma.analyticsEvent.findMany({
    where: { courseId, actorId: { in: studentIds }, occurredAt: { gte: activeCutoff } },
    select: { actorId: true },
    distinct: ["actorId"],
  });
  const active = new Set(activeActors.map((a) => a.actorId!));
  for (const s of submissions) if (s.submittedAt >= activeCutoff) active.add(s.userId);
  for (const s of sessions) if (s.startedAt >= activeCutoff) active.add(s.userId);

  let completedPairs = 0;
  for (const a of assignments) completedPairs += completionByAssignment.get(a.id) ?? 0;
  const courseDepth = interventionDepth(allFacts, threshold);

  const courseRows: Row[] = [
    mrow("active_students", metric(active.size, students.size, threshold), {
      windowDays: ACTIVE_WINDOW_DAYS,
    }),
    mrow("completion", completion(completedPairs, students.size * assignments.length, threshold)),
    mrow("first_attempt_correctness", firstAttemptCorrectness(allFacts, threshold)),
    mrow("final_correctness", finalCorrectness(allFacts, threshold)),
    mrow("guided_recovery", guidedRecovery(allFacts, threshold)),
    mrow("retry_improvement", retryImprovement(allFacts, threshold)),
    mrow("intervention_depth", courseDepth, { max: courseDepth.max }),
    mrow("socra_usage", metric(socraUsersAll.size, students.size, threshold)),
  ];

  // Weekly Socra usage (last WEEKS ISO weeks).
  const weekStartCutoff = isoWeek(new Date(now.getTime() - (WEEKS - 1) * 7 * DAY_MS)).start;
  const weekly = await prisma.$queryRaw<{ actorId: string; wk: Date }[]>`
    SELECT "actorId", date_trunc('week', "occurredAt") AS wk
    FROM "AnalyticsEvent"
    WHERE "courseId" = ${courseId} AND "actorId" = ANY(${studentIds}) AND "occurredAt" >= ${weekStartCutoff}
    GROUP BY 1, 2`;
  const activeByWeek = new Map<string, Set<string>>();
  for (const r of weekly) {
    const k = isoWeek(new Date(r.wk)).key;
    const set = activeByWeek.get(k) ?? new Set<string>();
    set.add(r.actorId);
    activeByWeek.set(k, set);
  }
  const socraByWeek = new Map<string, { users: Set<string>; sessions: number }>();
  for (const s of sessions) {
    if (s.startedAt < weekStartCutoff) continue;
    const k = isoWeek(s.startedAt).key;
    const entry = socraByWeek.get(k) ?? { users: new Set<string>(), sessions: 0 };
    entry.users.add(s.userId);
    entry.sessions += 1;
    socraByWeek.set(k, entry);
    const act = activeByWeek.get(k) ?? new Set<string>();
    act.add(s.userId);
    activeByWeek.set(k, act);
  }
  for (let i = WEEKS - 1; i >= 0; i--) {
    const w = isoWeek(new Date(now.getTime() - i * 7 * DAY_MS));
    const socra = socraByWeek.get(w.key);
    const activeW = activeByWeek.get(w.key)?.size ?? 0;
    const m = metric(socra?.users.size ?? 0, activeW, threshold);
    courseRows.push({
      ...mrow("socra_weekly_users", m, {
        sessions: socra?.sessions ?? 0,
        weekStart: w.start.toISOString(),
      }),
      windowKey: w.key,
      windowStart: w.start,
      windowEnd: new Date(w.start.getTime() + 7 * DAY_MS),
    });
  }

  // Recommendation: highest non-suppressed topic difficulty, with its most prevalent misconception.
  const recommendation = await buildRecommendation(
    difficultyByTopic,
    misconceptions,
    prevalenceByMisconception,
  );
  courseRows.push(jrow("recommendation", recommendation ?? { none: true }));

  // ---------------------------------------------------------------- write
  const common = {
    metricVersion: METRIC_VERSION,
    timezone: course.timezone ?? timezone,
    computedAt: now,
  };
  const strip = <T extends Row>(r: T) => ({
    metricKey: r.metricKey,
    numerator: r.numerator,
    denominator: r.denominator,
    value: r.value,
    sampleSize: r.sampleSize,
    suppressed: r.suppressed,
    metric: r.metric,
    windowKey: r.windowKey ?? "all",
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    segment: r.segment ?? "all",
    ...common,
  });
  await prisma.$transaction(
    async (tx) => {
      await tx.courseAggregate.deleteMany({ where: { courseId } });
      await tx.assignmentAggregate.deleteMany({ where: { courseId } });
      await tx.questionAggregate.deleteMany({ where: { courseId } });
      await tx.topicAggregate.deleteMany({ where: { courseId } });
      await tx.misconceptionAggregate.deleteMany({ where: { courseId } });
      await tx.courseAggregate.createMany({
        data: courseRows.map((r) => ({ courseId, ...strip(r) })),
      });
      await tx.assignmentAggregate.createMany({
        data: assignmentRows.map((r) => ({ courseId, assignmentId: r.assignmentId, ...strip(r) })),
      });
      await tx.questionAggregate.createMany({
        data: questionRows.map((r) => ({
          courseId,
          assignmentId: r.assignmentId,
          questionId: r.questionId,
          ...strip(r),
        })),
      });
      await tx.topicAggregate.createMany({
        data: topicRows.map((r) => ({ courseId, topicId: r.topicId, ...strip(r) })),
      });
      await tx.misconceptionAggregate.createMany({
        data: misconceptionRows.map((r) => ({
          courseId,
          misconceptionId: r.misconceptionId,
          topicId: r.topicId,
          assignmentId: r.assignmentId,
          confidenceThreshold: MISCONCEPTION_MIN_CONFIDENCE,
          detectorVersions: r.detectorVersions,
          ...strip(r),
        })),
      });
    },
    { timeout: 60_000 },
  );
  return (
    courseRows.length +
    assignmentRows.length +
    questionRows.length +
    topicRows.length +
    misconceptionRows.length
  );
}

async function buildRecommendation(
  difficultyByTopic: Map<string, MetricValue>,
  misconceptions: { id: string; topicId: string }[],
  prevalence: Map<string, MetricValue>,
): Promise<Recommendation | null> {
  let bestTopic: string | null = null;
  let best: MetricValue | null = null;
  for (const [topicId, m] of difficultyByTopic) {
    if (m.suppressed || m.value === null) continue;
    const bv = best?.value ?? 0;
    // Rank by rate, then by more students affected, then by larger denominator (a rate over more students is firmer).
    if (
      !best ||
      m.value > bv ||
      (m.value === bv &&
        (m.numerator > best.numerator ||
          (m.numerator === best.numerator && m.denominator > best.denominator)))
    ) {
      best = m;
      bestTopic = topicId;
    }
  }
  if (!bestTopic || !best || best.numerator === 0) return null;
  const topic = await prisma.topic.findUnique({ where: { id: bestTopic }, select: { name: true } });
  if (!topic) return null;
  let topMis: { id: string; m: MetricValue } | null = null;
  const smallN = env().ANALYTICS_SMALL_N_THRESHOLD;
  for (const mis of misconceptions.filter((x) => x.topicId === bestTopic)) {
    const m = prevalence.get(mis.id);
    // Never name a misconception held by fewer distinct students than the small-group threshold (re-identification risk).
    if (!m || m.suppressed || m.value === null || m.numerator < smallN) continue;
    if (!topMis || m.value > (topMis.m.value ?? 0)) topMis = { id: mis.id, m };
  }
  let text = `${topic.name}: ${best.numerator} of ${best.denominator} students showed difficulty (${pct(best)}).`;
  if (topMis) {
    const label = await prisma.misconception.findUnique({
      where: { id: topMis.id },
      select: { label: true },
    });
    text += ` The most frequent recorded misconception was "${label?.label}" (${topMis.m.numerator} of ${topMis.m.denominator} students).`;
  }
  text += " Consider revisiting this concept in class or adding scaffolded practice on it.";
  return {
    text,
    topicId: bestTopic,
    basis: `Topic difficulty, n = ${best.denominator} students with graded or practice work on the topic`,
  };
}
