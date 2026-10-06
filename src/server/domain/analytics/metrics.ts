/**
 * Pure faculty-analytics metric functions (TASK §21, PRD §25 + Appendix B). No I/O.
 * Definitions are mirrored in docs/ANALYTICS_DICTIONARY.md; change both together and bump METRIC_VERSION.
 */
import type { DepthMetric, FunnelStep, MetricValue } from "./types";

export const METRIC_VERSION = 1;
/** A question attempt counts as correct only with full credit. */
export const CORRECT_FRACTION = 0.999;
/** Per-student topic difficulty at or above this => "showing difficulty" on the topic. */
export const STUDENT_DIFFICULTY_THRESHOLD = 0.5;
/** Topic is an unresolved concept when this share of students is currently Needs reinforcement. */
export const UNRESOLVED_SHARE_THRESHOLD = 0.25;
/** Minimum detector confidence for misconception analytics. */
export const MISCONCEPTION_MIN_CONFIDENCE = 0.6;
/** Window for "active students". */
export const ACTIVE_WINDOW_DAYS = 14;

/** Build a metric value with small-n suppression. */
export function metric(numerator: number, denominator: number, threshold: number): MetricValue {
  const suppressed = denominator < threshold;
  return {
    numerator,
    denominator,
    value: suppressed || denominator === 0 ? null : numerator / denominator,
    suppressed,
  };
}

/** Re-apply suppression with the current threshold (aggregates may be computed with an older one). */
export function resuppress(m: MetricValue, threshold: number): MetricValue {
  return metric(m.numerator, m.denominator, threshold);
}

export function depthMetric(levels: number[], threshold: number): DepthMetric {
  const sum = levels.reduce((s, l) => s + l, 0);
  const base = metric(sum, levels.length, threshold);
  return { ...base, max: base.suppressed || levels.length === 0 ? null : Math.max(...levels) };
}

// ---------------------------------------------------------------------------
// Student-question facts (one row per student x question that the student touched)
// ---------------------------------------------------------------------------

export interface GradedAttempt {
  attemptNumber: number;
  submittedAt: Date;
  /** 0..1 score fraction from an authoritative grade. */
  fraction: number;
  contentHash?: string | null;
}

export interface StudentQuestionFact {
  userId: string;
  questionId: string;
  assignmentId: string;
  /** Any submission containing this question (graded or not). */
  submitted: boolean;
  /** Authoritative graded attempts, ascending by attemptNumber. */
  attempts: GradedAttempt[];
  /** Earliest Socra interaction on this question (session start or first prompt). */
  socraFirstAt: Date | null;
  /** Highest intervention level reached on this question (0..6); null when Socra was not used. */
  maxLevel: number | null;
  /** Draft/answer change events after the first Socra interaction. */
  changedAfterSocra: boolean;
}

const isCorrect = (f: number) => f >= CORRECT_FRACTION;

/** Correct first valid answer / students with a valid (graded) first answer. */
export function firstAttemptCorrectness(facts: StudentQuestionFact[], threshold: number) {
  const eligible = facts.filter((f) => f.attempts.length > 0);
  return metric(
    eligible.filter((f) => isCorrect(f.attempts[0]!.fraction)).length,
    eligible.length,
    threshold,
  );
}

/** Correct final (latest graded) answer / students who submitted with a graded attempt. */
export function finalCorrectness(facts: StudentQuestionFact[], threshold: number) {
  const eligible = facts.filter((f) => f.attempts.length > 0);
  return metric(
    eligible.filter((f) => isCorrect(f.attempts[f.attempts.length - 1]!.fraction)).length,
    eligible.length,
    threshold,
  );
}

/** Graded attempts submitted after the first Socra interaction. */
function attemptsAfterSocra(f: StudentQuestionFact): GradedAttempt[] {
  if (!f.socraFirstAt) return [];
  return f.attempts.filter((a) => a.submittedAt.getTime() > f.socraFirstAt!.getTime());
}

/**
 * "Revised after Socra": the student used Socra on the question, then submitted a graded attempt after that,
 * and the answer changed (draft/answer change event after Socra, or a different answer hash than the previous attempt).
 */
export function revisedAfterSocra(f: StudentQuestionFact): boolean {
  const after = attemptsAfterSocra(f);
  if (after.length === 0) return false;
  if (f.changedAfterSocra) return true;
  const firstAfter = after[0]!;
  const idx = f.attempts.indexOf(firstAfter);
  if (idx <= 0) return false;
  const prev = f.attempts[idx - 1]!;
  return Boolean(
    firstAfter.contentHash && prev.contentHash && firstAfter.contentHash !== prev.contentHash,
  );
}

/** Correct after Socra + revision / Socra users who revised. */
export function guidedRecovery(facts: StudentQuestionFact[], threshold: number) {
  const revised = facts.filter(revisedAfterSocra);
  const recovered = revised.filter((f) => {
    const after = attemptsAfterSocra(f);
    return isCorrect(after[after.length - 1]!.fraction);
  });
  return metric(recovered.length, revised.length, threshold);
}

/** Students whose later valid attempt scored higher than their first / students with 2+ graded attempts. */
export function retryImprovement(facts: StudentQuestionFact[], threshold: number) {
  const retried = facts.filter((f) => f.attempts.length >= 2);
  const improved = retried.filter(
    (f) => f.attempts[f.attempts.length - 1]!.fraction > f.attempts[0]!.fraction,
  );
  return metric(improved.length, retried.length, threshold);
}

/** Mean of the per-task (student-question) maximum intervention level, over tasks with Socra use; plus max. */
export function interventionDepth(facts: StudentQuestionFact[], threshold: number): DepthMetric {
  return depthMetric(
    facts.filter((f) => f.maxLevel !== null).map((f) => f.maxLevel as number),
    threshold,
  );
}

export function retryCount(facts: StudentQuestionFact[]): number {
  return facts.filter((f) => f.attempts.length >= 2).length;
}

/** Submitted / assigned. */
export function completion(submitted: number, assigned: number, threshold: number) {
  return metric(submitted, assigned, threshold);
}

/** Unique students with canonical misconception evidence / eligible students. */
export function misconceptionPrevalence(
  studentsWithObservation: Iterable<string>,
  eligibleStudents: Iterable<string>,
  threshold: number,
) {
  const eligible = new Set(eligibleStudents);
  const observed = new Set([...studentsWithObservation].filter((s) => eligible.has(s)));
  return metric(observed.size, eligible.size, threshold);
}

// ---------------------------------------------------------------------------
// Topic difficulty and unresolved concepts
// ---------------------------------------------------------------------------

export interface TopicOutcome {
  userId: string;
  /** 0..1 outcome value (correctness / practice success). */
  value: number;
  /** Source factor of the evidence (learner model, ltm-v1). */
  sourceFactor: number;
  /** Independence factor (1 = no help, 0.25 = escalation-level help). */
  independence: number;
}

/** Per-student difficulty = Σ s·(1 − value·independence) / Σ s. Incorrect and heavily assisted outcomes both count. */
export function studentTopicDifficulty(outcomes: TopicOutcome[]): number | null {
  let num = 0;
  let den = 0;
  for (const o of outcomes) {
    num += o.sourceFactor * (1 - Math.min(1, Math.max(0, o.value)) * o.independence);
    den += o.sourceFactor;
  }
  return den > 0 ? num / den : null;
}

/** Students showing difficulty on a topic / students with graded or practice evidence on it. */
export function topicDifficulty(outcomes: TopicOutcome[], threshold: number): MetricValue {
  const byStudent = new Map<string, TopicOutcome[]>();
  for (const o of outcomes) {
    const list = byStudent.get(o.userId) ?? [];
    list.push(o);
    byStudent.set(o.userId, list);
  }
  let showing = 0;
  for (const list of byStudent.values()) {
    const d = studentTopicDifficulty(list);
    if (d !== null && d >= STUDENT_DIFFICULTY_THRESHOLD) showing += 1;
  }
  return metric(showing, byStudent.size, threshold);
}

/** Students currently Needs reinforcement / students with a topic state. */
export function unresolvedShare(states: { state: string }[], threshold: number): MetricValue {
  return metric(
    states.filter((s) => s.state === "NEEDS_REINFORCEMENT").length,
    states.length,
    threshold,
  );
}

export function isUnresolved(m: MetricValue): boolean {
  return !m.suppressed && m.value !== null && m.value >= UNRESOLVED_SHARE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Interaction funnel (from events)
// ---------------------------------------------------------------------------

export interface FunnelInput {
  opened: Set<string>;
  attempted: Set<string>;
  askedSocra: Set<string>;
  revised: Set<string>;
  correctAfterRevision: Set<string>;
}

/** Each step is restricted to students in the previous step, so the funnel is monotone. */
export function funnel(input: FunnelInput): FunnelStep[] {
  const opened = new Set([...input.opened, ...input.attempted]);
  const attempted = new Set([...input.attempted].filter((s) => opened.has(s)));
  const asked = new Set([...input.askedSocra].filter((s) => opened.has(s)));
  const revised = new Set([...input.revised].filter((s) => asked.has(s)));
  const correct = new Set([...input.correctAfterRevision].filter((s) => revised.has(s)));
  return [
    { key: "opened", label: "Opened the question", count: opened.size },
    { key: "attempted", label: "Attempted (ran, saved or submitted)", count: attempted.size },
    { key: "asked_socra", label: "Asked Socra", count: asked.size },
    { key: "revised", label: "Revised after Socra", count: revised.size },
    { key: "correct_after_revision", label: "Correct after revision", count: correct.size },
  ];
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** ISO-8601 week key (UTC), e.g. "2026-W41", and the Monday it starts. */
export function isoWeek(d: Date): { key: string; start: Date } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { key: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, start: monday };
}

/** Format a metric for plain text (brief, recommendation). */
export function pct(m: MetricValue): string {
  return m.value === null ? "insufficient data" : `${Math.round(m.value * 100)}%`;
}
