import "server-only";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { recordEvent } from "@/server/events/outbox";
import { isEnabled } from "@/server/flags";
import { AuthError, assertCan, courseIdsWithRole, type Principal } from "@/server/auth/rbac";
import { getDescendants, getPrerequisites } from "@/server/domain/knowledge-graph";
import { recomputeAggregates } from "./aggregate";
import { isUnresolved, metric } from "./metrics";
import type {
  AssignmentAnalytics,
  AssignmentSummaryRow,
  CourseOverview,
  DepthMetric,
  FunnelStep,
  MetricValue,
  MisconceptionPatternRow,
  QuestionDrilldown,
  QuestionSummaryRow,
  Recommendation,
  TopicDrilldown,
  TopicMetricRow,
  WeeklyUsageRow,
} from "./types";

/**
 * Faculty analytics reads. All values come from the *Aggregate tables written by recomputeAggregates (computed on
 * demand the first time a course is viewed). Authorization: analytics:course:read (course INSTRUCTOR, or TA as the
 * RBAC policy permits) + the facultyAnalytics feature flag. Every read emits analytics_viewed.
 * No student identity and no conversation content is ever returned.
 */

type AggRow = {
  metricKey: string;
  metric: unknown;
  computedAt: Date;
  windowKey?: string;
  segment?: string;
};

const threshold = () => env().ANALYTICS_SMALL_N_THRESHOLD;

function emptyMetric(): MetricValue {
  return metric(0, 0, threshold());
}

function toMetric(row: AggRow | undefined): MetricValue {
  if (!row) return emptyMetric();
  const m = row.metric as { numerator?: number; denominator?: number };
  return metric(m.numerator ?? 0, m.denominator ?? 0, threshold());
}

function toDepth(row: AggRow | undefined): DepthMetric {
  const base = toMetric(row);
  const max = (row?.metric as { max?: number | null } | undefined)?.max ?? null;
  return { ...base, max: base.suppressed ? null : max };
}

function byKey<T extends AggRow>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.metricKey, r]));
}

function latest(rows: AggRow[]): string | null {
  const t = rows.reduce<number>((acc, r) => Math.max(acc, r.computedAt.getTime()), 0);
  return t > 0 ? new Date(t).toISOString() : null;
}

async function authorize(user: Principal, courseId: string): Promise<void> {
  assertCan(user, "analytics:course:read", { courseId });
  if (!(await isEnabled("facultyAnalytics", { courseId }))) {
    throw new AuthError(403, "feature_disabled", "Faculty analytics is turned off for this course");
  }
}

async function ensureAggregates(courseId: string): Promise<void> {
  const exists = await prisma.courseAggregate.findFirst({
    where: { courseId },
    select: { id: true },
  });
  if (!exists) await recomputeAggregates(courseId);
}

async function viewed(
  user: Principal,
  courseId: string,
  viewType: string,
  scope: Record<string, string>,
) {
  await recordEvent({
    eventName: "analytics_viewed",
    actorId: user.id,
    courseId,
    researchCondition: null,
    metadata: { viewType, scope },
  });
}

/** Courses where the user may read analytics (for the course selector). */
export async function listStaffCourses(user: Principal) {
  const ids = courseIdsWithRole(user, ["INSTRUCTOR", "TA"]);
  if (ids.length === 0) return [];
  return prisma.course.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, title: true, term: true },
    orderBy: { code: "asc" },
  });
}

// ---------------------------------------------------------------------------

async function topicRows(courseId: string, topicIds?: string[]): Promise<TopicMetricRow[]> {
  const [topics, rows] = await Promise.all([
    prisma.topic.findMany({
      where: { courseId, ...(topicIds ? { id: { in: topicIds } } : {}) },
      select: { id: true, name: true },
    }),
    prisma.topicAggregate.findMany({
      where: {
        courseId,
        ...(topicIds ? { topicId: { in: topicIds } } : {}),
        windowKey: "all",
        segment: "all",
      },
    }),
  ]);
  return topics.map((t) => {
    const m = byKey(rows.filter((r) => r.topicId === t.id));
    return {
      topicId: t.id,
      name: t.name,
      unresolved: toMetric(m.get("unresolved")),
      firstAttemptCorrectness: toMetric(m.get("first_attempt_correctness")),
      finalCorrectness: toMetric(m.get("final_correctness")),
      difficulty: toMetric(m.get("difficulty")),
    };
  });
}

/** Rank: non-suppressed by value desc, then suppressed rows last (UI groups them as "too few responses"). */
function rank<T>(rows: T[], pick: (r: T) => MetricValue): T[] {
  return [...rows].sort((a, b) => {
    const ma = pick(a);
    const mb = pick(b);
    if (ma.suppressed !== mb.suppressed) return ma.suppressed ? 1 : -1;
    return (mb.value ?? -1) - (ma.value ?? -1) || mb.denominator - ma.denominator;
  });
}

async function misconceptionRows(
  courseId: string,
  where: { topicId?: string; questionId?: string } = {},
): Promise<MisconceptionPatternRow[]> {
  const rows = await prisma.misconceptionAggregate.findMany({
    where: {
      courseId,
      metricKey: "prevalence",
      windowKey: "all",
      segment: where.questionId ? `question:${where.questionId}` : "all",
      ...(where.topicId ? { topicId: where.topicId } : {}),
      ...(where.questionId ? {} : { assignmentId: "" }),
    },
  });
  if (rows.length === 0) return [];
  const mis = await prisma.misconception.findMany({
    where: { id: { in: rows.map((r) => r.misconceptionId) }, reviewStatus: "APPROVED" },
    select: { id: true, key: true, label: true, topicId: true, topic: { select: { name: true } } },
  });
  const byId = new Map(mis.map((m) => [m.id, m]));
  const out: MisconceptionPatternRow[] = [];
  for (const r of rows) {
    const m = byId.get(r.misconceptionId);
    if (!m) continue; // candidates / rejected labels never appear
    const prevalence = toMetric(r);
    // Never name a misconception held by fewer distinct students than the small-group threshold.
    const tooFew = prevalence.numerator < threshold();
    out.push({
      misconceptionId: m.id,
      key: m.key,
      label: m.label,
      topicId: m.topicId,
      topicName: m.topic.name,
      prevalence: tooFew ? { ...prevalence, suppressed: true, value: null } : prevalence,
      observationCount: (r.metric as { observationCount?: number }).observationCount ?? 0,
    });
  }
  return rank(out, (r) => r.prevalence);
}

function funnelFrom(row: AggRow | undefined): FunnelStep[] {
  return ((row?.metric as { steps?: FunnelStep[] } | undefined)?.steps ?? []).map((s) => ({
    ...s,
  }));
}

// ---------------------------------------------------------------------------

export async function getCourseOverview(
  user: Principal,
  courseId: string,
): Promise<CourseOverview> {
  await authorize(user, courseId);
  await ensureAggregates(courseId);
  const [course, courseAgg, assignments, assignmentAgg] = await Promise.all([
    prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: { id: true, code: true, title: true },
    }),
    prisma.courseAggregate.findMany({ where: { courseId } }),
    prisma.assignment.findMany({
      where: { courseId, state: { in: ["PUBLISHED_PROTECTED", "CLOSED"] } },
      select: { id: true, title: true, state: true, dueAt: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.assignmentAggregate.findMany({ where: { courseId, windowKey: "all", segment: "all" } }),
  ]);
  const all = byKey(courseAgg.filter((r) => r.windowKey === "all"));
  const topics = await topicRows(courseId);
  const rankedTopics = rank(topics, (t) => t.difficulty);
  const painPoints = rankedTopics.slice(0, 8);
  const unresolved = rank(
    topics.filter((t) => isUnresolved(t.unresolved)),
    (t) => t.unresolved,
  );
  const weeklyUsage: WeeklyUsageRow[] = courseAgg
    .filter((r) => r.metricKey === "socra_weekly_users")
    .sort((a, b) => (a.windowStart?.getTime() ?? 0) - (b.windowStart?.getTime() ?? 0))
    .map((r) => ({
      week: r.windowKey,
      weekStart: (r.windowStart ?? r.computedAt).toISOString(),
      socraUsers: toMetric(r),
      sessions: (r.metric as { sessions?: number }).sessions ?? 0,
    }));
  const recRaw = all.get("recommendation")?.metric as
    (Recommendation & { none?: boolean }) | undefined;
  const assignmentRows: AssignmentSummaryRow[] = assignments.map((a) => {
    const m = byKey(assignmentAgg.filter((r) => r.assignmentId === a.id));
    return {
      assignmentId: a.id,
      title: a.title,
      state: a.state,
      dueAt: a.dueAt?.toISOString() ?? null,
      completion: toMetric(m.get("completion")),
      firstAttemptCorrectness: toMetric(m.get("first_attempt_correctness")),
      finalCorrectness: toMetric(m.get("final_correctness")),
      guidedRecovery: toMetric(m.get("guided_recovery")),
      interventionDepth: toDepth(m.get("intervention_depth")),
    };
  });

  await viewed(user, courseId, "course_overview", { courseId });
  return {
    courseId,
    courseCode: course.code,
    courseTitle: course.title,
    computedAt: latest(courseAgg),
    threshold: threshold(),
    activeStudents: toMetric(all.get("active_students")),
    completion: toMetric(all.get("completion")),
    firstAttemptCorrectness: toMetric(all.get("first_attempt_correctness")),
    finalCorrectness: toMetric(all.get("final_correctness")),
    guidedRecovery: toMetric(all.get("guided_recovery")),
    retryImprovement: toMetric(all.get("retry_improvement")),
    interventionDepth: toDepth(all.get("intervention_depth")),
    socraUsage: toMetric(all.get("socra_usage")),
    painPoints,
    topics: rankedTopics,
    unresolvedConcepts: unresolved,
    misconceptions: await misconceptionRows(courseId),
    weeklyUsage,
    assignments: assignmentRows,
    recommendation: recRaw && !recRaw.none ? recRaw : null,
  };
}

async function questionSummaries(
  courseId: string,
  questionIds: string[],
): Promise<Map<string, Map<string, AggRow>>> {
  const rows = await prisma.questionAggregate.findMany({
    where: { courseId, questionId: { in: questionIds }, windowKey: "all", segment: "all" },
  });
  const out = new Map<string, Map<string, AggRow>>();
  for (const q of questionIds) out.set(q, byKey(rows.filter((r) => r.questionId === q)));
  return out;
}

export async function getAssignmentAnalytics(
  user: Principal,
  assignmentId: string,
): Promise<AssignmentAnalytics> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      courseId: true,
      title: true,
      state: true,
      questions: {
        select: { id: true, order: true, currentVersion: { select: { title: true } } },
        orderBy: { order: "asc" },
      },
      topics: { select: { topicId: true } },
    },
  });
  if (!assignment) throw new AuthError(404, "not_found");
  await authorize(user, assignment.courseId);
  await ensureAggregates(assignment.courseId);
  const rows = await prisma.assignmentAggregate.findMany({
    where: { assignmentId, windowKey: "all", segment: "all" },
  });
  const m = byKey(rows);
  const qs = await questionSummaries(
    assignment.courseId,
    assignment.questions.map((q) => q.id),
  );
  const questionTopicIds = await prisma.questionTopic.findMany({
    where: { questionId: { in: assignment.questions.map((q) => q.id) } },
    select: { topicId: true },
  });
  const topicIds = [
    ...new Set([
      ...assignment.topics.map((t) => t.topicId),
      ...questionTopicIds.map((t) => t.topicId),
    ]),
  ];
  const questions: QuestionSummaryRow[] = assignment.questions.map((q, i) => {
    const qm = qs.get(q.id)!;
    return {
      questionId: q.id,
      title: q.currentVersion?.title ?? `Question ${i + 1}`,
      order: q.order,
      firstAttemptCorrectness: toMetric(qm.get("first_attempt_correctness")),
      finalCorrectness: toMetric(qm.get("final_correctness")),
      interventionDepth: toDepth(qm.get("intervention_depth")),
    };
  });
  await viewed(user, assignment.courseId, "assignment", { assignmentId });
  return {
    assignmentId,
    courseId: assignment.courseId,
    title: assignment.title,
    state: assignment.state,
    threshold: threshold(),
    computedAt: latest(rows),
    completion: toMetric(m.get("completion")),
    firstAttemptCorrectness: toMetric(m.get("first_attempt_correctness")),
    finalCorrectness: toMetric(m.get("final_correctness")),
    guidedRecovery: toMetric(m.get("guided_recovery")),
    retryImprovement: toMetric(m.get("retry_improvement")),
    interventionDepth: toDepth(m.get("intervention_depth")),
    questions,
    topics: rank(await topicRows(assignment.courseId, topicIds), (t) => t.difficulty),
    funnel: funnelFrom(m.get("funnel")),
  };
}

export async function getQuestionDrilldown(
  user: Principal,
  questionId: string,
): Promise<QuestionDrilldown> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      order: true,
      currentVersion: { select: { title: true, prompt: true } },
      topics: { select: { topic: { select: { id: true, name: true } } } },
      assignment: { select: { id: true, title: true, courseId: true } },
    },
  });
  if (!question) throw new AuthError(404, "not_found");
  const courseId = question.assignment.courseId;
  await authorize(user, courseId);
  await ensureAggregates(courseId);
  const rows = await prisma.questionAggregate.findMany({
    where: { questionId, windowKey: "all", segment: "all" },
  });
  const m = byKey(rows);
  const count = (k: string) => (m.get(k)?.metric as { count?: number } | undefined)?.count ?? 0;
  await viewed(user, courseId, "question_drilldown", { questionId });
  return {
    questionId,
    assignmentId: question.assignment.id,
    assignmentTitle: question.assignment.title,
    courseId,
    title: question.currentVersion?.title ?? `Question ${question.order + 1}`,
    prompt: question.currentVersion?.prompt ?? "",
    threshold: threshold(),
    computedAt: latest(rows),
    topics: question.topics.map((t) => ({ topicId: t.topic.id, name: t.topic.name })),
    firstAttemptCorrectness: toMetric(m.get("first_attempt_correctness")),
    finalCorrectness: toMetric(m.get("final_correctness")),
    guidedRecovery: toMetric(m.get("guided_recovery")),
    retryImprovement: toMetric(m.get("retry_improvement")),
    interventionDepth: toDepth(m.get("intervention_depth")),
    completion: toMetric(m.get("completion")),
    completionCount: count("completion_count"),
    retryCount: count("retry_count"),
    misconceptions: await misconceptionRows(courseId, { questionId }),
    funnel: funnelFrom(m.get("funnel")),
  };
}

export async function getTopicDrilldown(user: Principal, topicId: string): Promise<TopicDrilldown> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, courseId: true, name: true, description: true },
  });
  if (!topic) throw new AuthError(404, "not_found");
  await authorize(user, topic.courseId);
  await ensureAggregates(topic.courseId);
  const [rows, prereqs, dependents, qt] = await Promise.all([
    prisma.topicAggregate.findMany({ where: { topicId, windowKey: "all", segment: "all" } }),
    getPrerequisites(topicId),
    getDescendants(topicId),
    prisma.questionTopic.findMany({
      where: {
        topicId,
        question: { assignment: { state: { in: ["PUBLISHED_PROTECTED", "CLOSED"] } } },
      },
      select: {
        question: {
          select: {
            id: true,
            order: true,
            currentVersion: { select: { title: true } },
            assignment: { select: { id: true, title: true } },
          },
        },
      },
    }),
  ]);
  const m = byKey(rows);
  const qs = await questionSummaries(
    topic.courseId,
    qt.map((q) => q.question.id),
  );
  await viewed(user, topic.courseId, "topic_drilldown", { topicId });
  return {
    topicId,
    courseId: topic.courseId,
    name: topic.name,
    description: topic.description,
    threshold: threshold(),
    computedAt: latest(rows),
    prerequisites: prereqs.map((p) => ({ topicId: p.topicId, name: p.name })),
    dependents: dependents.map((p) => ({ topicId: p.topicId, name: p.name })),
    stateDistribution: {
      needsReinforcement: toMetric(m.get("state_needs_reinforcement")),
      developing: toMetric(m.get("state_developing")),
      consistentlyDemonstrated: toMetric(m.get("state_consistently_demonstrated")),
    },
    firstAttemptCorrectness: toMetric(m.get("first_attempt_correctness")),
    finalCorrectness: toMetric(m.get("final_correctness")),
    interventionDepth: toDepth(m.get("intervention_depth")),
    questions: qt.map(({ question: q }) => {
      const qm = qs.get(q.id)!;
      return {
        questionId: q.id,
        title: q.currentVersion?.title ?? `Question ${q.order + 1}`,
        order: q.order,
        assignmentId: q.assignment.id,
        assignmentTitle: q.assignment.title,
        firstAttemptCorrectness: toMetric(qm.get("first_attempt_correctness")),
        finalCorrectness: toMetric(qm.get("final_correctness")),
        interventionDepth: toDepth(qm.get("intervention_depth")),
      };
    }),
    misconceptions: await misconceptionRows(topic.courseId, { topicId }),
  };
}

export async function getMisconceptionPatterns(
  user: Principal,
  courseId: string,
): Promise<MisconceptionPatternRow[]> {
  await authorize(user, courseId);
  await ensureAggregates(courseId);
  await viewed(user, courseId, "misconception_patterns", { courseId });
  return misconceptionRows(courseId);
}
