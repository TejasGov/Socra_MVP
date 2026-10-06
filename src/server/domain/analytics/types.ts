/**
 * Every metric value carries its numerator and denominator. `suppressed` is true when the denominator is below
 * ANALYTICS_SMALL_N_THRESHOLD; then `value` is null and the UI shows "Insufficient data".
 */
export interface MetricValue {
  numerator: number;
  denominator: number;
  value: number | null;
  suppressed: boolean;
}

/** Average-type metric (e.g. intervention depth): value = sum / count, max separately. */
export interface DepthMetric extends MetricValue {
  max: number | null;
}

export interface TopicMetricRow {
  topicId: string;
  name: string;
  /** Share of student-topic states that are NEEDS_REINFORCEMENT (unresolved concept). */
  unresolved: MetricValue;
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  /** 1 - first-attempt correctness on the topic's questions, weighted by attempts. */
  difficulty: MetricValue;
}

export interface MisconceptionPatternRow {
  misconceptionId: string;
  key: string;
  label: string;
  topicId: string;
  topicName: string;
  prevalence: MetricValue;
  observationCount: number;
}

export interface WeeklyUsageRow {
  /** ISO week key, e.g. "2026-W40". */
  week: string;
  weekStart: string;
  /** Students who started a Socra session that week / active students. */
  socraUsers: MetricValue;
  sessions: number;
}

export interface AssignmentSummaryRow {
  assignmentId: string;
  title: string;
  state: string;
  dueAt: string | null;
  completion: MetricValue;
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  guidedRecovery: MetricValue;
  interventionDepth: DepthMetric;
}

export interface Recommendation {
  /** Plain-language, non-causal observation tied to a metric. */
  text: string;
  topicId: string | null;
  basis: string;
}

export interface CourseOverview {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  computedAt: string | null;
  threshold: number;
  activeStudents: MetricValue;
  completion: MetricValue;
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  guidedRecovery: MetricValue;
  retryImprovement: MetricValue;
  interventionDepth: DepthMetric;
  socraUsage: MetricValue;
  painPoints: TopicMetricRow[];
  /** Every course topic, ranked by difficulty (suppressed last). */
  topics: TopicMetricRow[];
  unresolvedConcepts: TopicMetricRow[];
  misconceptions: MisconceptionPatternRow[];
  weeklyUsage: WeeklyUsageRow[];
  assignments: AssignmentSummaryRow[];
  recommendation: Recommendation | null;
}

export interface FunnelStep {
  key: "opened" | "attempted" | "asked_socra" | "revised" | "correct_after_revision";
  label: string;
  count: number;
}

export interface QuestionSummaryRow {
  questionId: string;
  title: string;
  order: number;
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  interventionDepth: DepthMetric;
}

export interface AssignmentAnalytics {
  assignmentId: string;
  courseId: string;
  title: string;
  state: string;
  threshold: number;
  computedAt: string | null;
  completion: MetricValue;
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  guidedRecovery: MetricValue;
  retryImprovement: MetricValue;
  interventionDepth: DepthMetric;
  questions: QuestionSummaryRow[];
  topics: TopicMetricRow[];
  funnel: FunnelStep[];
}

export interface QuestionDrilldown {
  questionId: string;
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  title: string;
  prompt: string;
  threshold: number;
  computedAt: string | null;
  topics: { topicId: string; name: string }[];
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  guidedRecovery: MetricValue;
  retryImprovement: MetricValue;
  interventionDepth: DepthMetric;
  completion: MetricValue;
  completionCount: number;
  retryCount: number;
  misconceptions: MisconceptionPatternRow[];
  funnel: FunnelStep[];
}

export interface TopicDrilldown {
  topicId: string;
  courseId: string;
  name: string;
  description: string | null;
  threshold: number;
  computedAt: string | null;
  prerequisites: { topicId: string; name: string }[];
  dependents: { topicId: string; name: string }[];
  stateDistribution: {
    needsReinforcement: MetricValue;
    developing: MetricValue;
    consistentlyDemonstrated: MetricValue;
  };
  firstAttemptCorrectness: MetricValue;
  finalCorrectness: MetricValue;
  interventionDepth: DepthMetric;
  questions: (QuestionSummaryRow & { assignmentId: string; assignmentTitle: string })[];
  misconceptions: MisconceptionPatternRow[];
}

export interface RecomputeAggregatesResult {
  courses: number;
  rows: number;
  durationMs: number;
}
