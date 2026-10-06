import type {
  ConfidenceLevel,
  EvidenceSourceType,
  EvidenceType,
  TopicStateLabel,
  Trajectory,
} from "@/generated/prisma/enums";
import { LEARNER_MODEL_VERSION } from "./types";

/**
 * Learner topic-state model V1 ("ltm-v1"). Pure and deterministic: same evidence + same asOf => same state.
 * Documented in docs/LEARNER_MODEL.md. Do not change constants without bumping LEARNER_MODEL_VERSION.
 *
 *   w_i     = recency_i × independence_i × source_i
 *   score   = Σ w_i·value_i / Σ w_i            (internal only, never shown as a percentage)
 *   E       = Σ w_i                            (effective evidence)
 *   CONSISTENTLY_DEMONSTRATED  score ≥ 0.8 AND n ≥ 4 AND E ≥ 2.0
 *   NEEDS_REINFORCEMENT        score < 0.5 AND n ≥ 2
 *   DEVELOPING                 otherwise
 */
export const LTM_PARAMS = {
  version: LEARNER_MODEL_VERSION,
  halfLifeDays: 21,
  demonstratedScore: 0.8,
  demonstratedMinObservations: 4,
  demonstratedMinEffectiveEvidence: 2.0,
  reinforceScore: 0.5,
  reinforceMinObservations: 2,
  confidenceMediumAt: 1.0,
  confidenceHighAt: 2.5,
  trajectoryWindowDays: 14,
  trajectoryMinPerWindow: 2,
  trajectoryDelta: 0.15,
  /** Scoring observation counts as "demonstrated" when value ≥ this and independence ≥ demonstratedIndependence. */
  demonstratedValue: 0.8,
  demonstratedIndependence: 0.85,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EvidenceObservation {
  evidenceType: EvidenceType;
  sourceType: EvidenceSourceType;
  /** Normalized 0..1. */
  value: number;
  occurredAt: Date;
  assisted: boolean;
  /** Highest Socra intervention level (0..6) before/while producing this evidence; null = none recorded. */
  maxInterventionLevel: number | null;
  /** Canonical misconception label for MISCONCEPTION_OBSERVED rows. */
  misconceptionLabel?: string | null;
}

export interface TopicStateResult {
  state: TopicStateLabel;
  score: number;
  effectiveEvidence: number;
  observationCount: number;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  trajectory: Trajectory;
  lastEvidenceAt: Date | null;
  lastDemonstratedAt: Date | null;
  commonDifficulty: string | null;
  misconceptionSummary: Record<string, number>;
  assistanceDependency: number | null;
  firstAttemptRate: number | null;
  explanation: string;
  algorithmVersion: string;
}

/** Evidence types that bear on proficiency, with their source factor. Others are context only. */
export function sourceFactor(type: EvidenceType, source: EvidenceSourceType): number | null {
  switch (type) {
    case "FIRST_ATTEMPT_CORRECTNESS":
      return source === "PRACTICE" ? 0.6 : 1.0;
    case "TRANSFER":
      return 1.0;
    case "FINAL_CORRECTNESS":
      return source === "PRACTICE" ? 0.6 : 0.7;
    case "PRACTICE_SUCCESS":
      return 0.6;
    case "RETRY_IMPROVEMENT":
      return 0.5;
    default:
      // SOCRA_USAGE, INTERVENTION_DEPTH, RECOVERY_AFTER_GUIDANCE, MISCONCEPTION_OBSERVED: non-scoring.
      return null;
  }
}

/** Independence factor from the deepest help received (TASK §16: independent > heavily assisted). */
export function independenceFactor(maxLevel: number | null, assisted: boolean): number {
  const level = maxLevel ?? (assisted ? 1 : 0);
  if (level <= 0) return assisted ? 0.85 : 1.0;
  if (level <= 2) return 0.85;
  if (level <= 4) return 0.6;
  if (level === 5) return 0.4;
  return 0.25;
}

export function recencyFactor(occurredAt: Date, asOf: Date): number {
  const ageDays = Math.max(0, (asOf.getTime() - occurredAt.getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / LTM_PARAMS.halfLifeDays);
}

/** Full weight of one observation, or null if it does not bear on proficiency. */
export function evidenceWeight(obs: EvidenceObservation, asOf: Date): number | null {
  const s = sourceFactor(obs.evidenceType, obs.sourceType);
  if (s === null) return null;
  return (
    recencyFactor(obs.occurredAt, asOf) *
    independenceFactor(obs.maxInterventionLevel, obs.assisted) *
    s
  );
}

/** Static (non-recency) part of the weight; stored on LearningEvidence.weight for transparency. */
export function staticWeight(
  obs: Pick<
    EvidenceObservation,
    "evidenceType" | "sourceType" | "maxInterventionLevel" | "assisted"
  >,
): number {
  const s = sourceFactor(obs.evidenceType, obs.sourceType);
  if (s === null) return 0;
  return independenceFactor(obs.maxInterventionLevel, obs.assisted) * s;
}

export function confidenceFor(effectiveEvidence: number): ConfidenceLevel {
  if (effectiveEvidence >= LTM_PARAMS.confidenceHighAt) return "HIGH";
  if (effectiveEvidence >= LTM_PARAMS.confidenceMediumAt) return "MEDIUM";
  return "LOW";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function windowMean(obs: EvidenceObservation[]): number | null {
  let num = 0;
  let den = 0;
  for (const o of obs) {
    const w = staticWeight(o);
    num += w * clamp01(o.value);
    den += w;
  }
  return den > 0 ? num / den : null;
}

export function trajectoryFor(scoring: EvidenceObservation[], asOf: Date): Trajectory {
  const cutoff = asOf.getTime() - LTM_PARAMS.trajectoryWindowDays * DAY_MS;
  const recent = scoring.filter((o) => o.occurredAt.getTime() >= cutoff);
  const earlier = scoring.filter((o) => o.occurredAt.getTime() < cutoff);
  if (
    recent.length < LTM_PARAMS.trajectoryMinPerWindow ||
    earlier.length < LTM_PARAMS.trajectoryMinPerWindow
  ) {
    return "STABLE";
  }
  const r = windowMean(recent);
  const e = windowMean(earlier);
  if (r === null || e === null) return "STABLE";
  if (r - e >= LTM_PARAMS.trajectoryDelta) return "IMPROVING";
  if (e - r >= LTM_PARAMS.trajectoryDelta) return "NEEDS_ATTENTION";
  return "STABLE";
}

const STATE_TEXT: Record<TopicStateLabel, string> = {
  NEEDS_REINFORCEMENT: "Needs reinforcement",
  DEVELOPING: "Developing",
  CONSISTENTLY_DEMONSTRATED: "Consistently demonstrated",
};

/** Compute the topic state from all (non-invalidated) evidence for one student-topic pair. */
export function computeTopicState(
  evidence: readonly EvidenceObservation[],
  asOf: Date = new Date(),
): TopicStateResult {
  // Only evidence observed at or before asOf (as-of rule: never use future evidence).
  // Canonical order so the floating-point sums are identical however the evidence was loaded.
  const usable = evidence
    .filter((o) => o.occurredAt.getTime() <= asOf.getTime())
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.evidenceType.localeCompare(b.evidenceType) ||
        a.value - b.value ||
        (a.maxInterventionLevel ?? -1) - (b.maxInterventionLevel ?? -1) ||
        Number(a.assisted) - Number(b.assisted) ||
        (a.misconceptionLabel ?? "").localeCompare(b.misconceptionLabel ?? ""),
    );
  const scoring = usable.filter((o) => sourceFactor(o.evidenceType, o.sourceType) !== null);

  let num = 0;
  let den = 0;
  let assistedCount = 0;
  let lastDemonstratedAt: Date | null = null;
  for (const o of scoring) {
    const w = evidenceWeight(o, asOf) ?? 0;
    num += w * clamp01(o.value);
    den += w;
    const ind = independenceFactor(o.maxInterventionLevel, o.assisted);
    if (ind < 1) assistedCount += 1;
    if (o.value >= LTM_PARAMS.demonstratedValue && ind >= LTM_PARAMS.demonstratedIndependence) {
      if (!lastDemonstratedAt || o.occurredAt > lastDemonstratedAt)
        lastDemonstratedAt = o.occurredAt;
    }
  }
  const n = scoring.length;
  const score = den > 0 ? num / den : 0;
  const effectiveEvidence = den;

  let state: TopicStateLabel = "DEVELOPING";
  if (
    score >= LTM_PARAMS.demonstratedScore &&
    n >= LTM_PARAMS.demonstratedMinObservations &&
    effectiveEvidence >= LTM_PARAMS.demonstratedMinEffectiveEvidence
  ) {
    state = "CONSISTENTLY_DEMONSTRATED";
  } else if (n >= LTM_PARAMS.reinforceMinObservations && score < LTM_PARAMS.reinforceScore) {
    state = "NEEDS_REINFORCEMENT";
  }

  // Misconceptions: most frequent label (ties -> most recent).
  const counts = new Map<string, { count: number; last: number }>();
  for (const o of usable) {
    if (o.evidenceType !== "MISCONCEPTION_OBSERVED" || !o.misconceptionLabel) continue;
    const c = counts.get(o.misconceptionLabel) ?? { count: 0, last: 0 };
    c.count += 1;
    c.last = Math.max(c.last, o.occurredAt.getTime());
    counts.set(o.misconceptionLabel, c);
  }
  let commonDifficulty: string | null = null;
  let best = { count: 0, last: 0 };
  let totalMis = 0;
  for (const [label, c] of counts) {
    totalMis += c.count;
    if (c.count > best.count || (c.count === best.count && c.last > best.last)) {
      best = c;
      commonDifficulty = label;
    }
  }
  const misconceptionSummary: Record<string, number> = {};
  for (const [label, c] of counts) misconceptionSummary[label] = c.count / totalMis;

  const firstAttempts = scoring.filter((o) => o.evidenceType === "FIRST_ATTEMPT_CORRECTNESS");
  const firstAttemptRate =
    firstAttempts.length > 0
      ? firstAttempts.reduce((s, o) => s + clamp01(o.value), 0) / firstAttempts.length
      : null;

  const lastEvidenceAt = usable.reduce<Date | null>(
    (acc, o) => (!acc || o.occurredAt > acc ? o.occurredAt : acc),
    null,
  );

  const confidence = confidenceFor(effectiveEvidence);
  const trajectory = trajectoryFor(scoring, asOf);

  const parts: string[] = [];
  if (n === 0) {
    parts.push("No graded or practice activity on this topic yet.");
  } else {
    parts.push(
      `${STATE_TEXT[state]}, based on ${n} graded or practice ${n === 1 ? "activity" : "activities"}.`,
    );
    if (assistedCount > 0) {
      parts.push(
        `${assistedCount} of ${n} involved hints, so they count for less than independent work.`,
      );
    }
    if (state === "DEVELOPING" && score >= LTM_PARAMS.demonstratedScore) {
      parts.push(
        "More independent attempts are needed before this is marked consistently demonstrated.",
      );
    }
  }
  if (commonDifficulty) parts.push(`Most frequent difficulty: ${commonDifficulty}.`);

  return {
    state,
    score,
    effectiveEvidence,
    observationCount: n,
    confidence,
    confidenceScore: Math.min(1, effectiveEvidence / LTM_PARAMS.confidenceHighAt),
    trajectory,
    lastEvidenceAt,
    lastDemonstratedAt,
    commonDifficulty,
    misconceptionSummary,
    assistanceDependency: n > 0 ? assistedCount / n : null,
    firstAttemptRate,
    explanation: parts.join(" "),
    algorithmVersion: LTM_PARAMS.version,
  };
}

/** Plain-language next step for the student view (no judgment, no precision). */
export function suggestedActionFor(
  state: TopicStateLabel,
  _topicName: string,
  commonDifficulty: string | null,
): string {
  switch (state) {
    case "NEEDS_REINFORCEMENT":
      return commonDifficulty
        ? `Practice at an easier level, focusing on: ${commonDifficulty}.`
        : "Practice at an easier level, then try a graded question again.";
    case "DEVELOPING":
      return "Answer a few practice questions without hints to confirm it.";
    case "CONSISTENTLY_DEMONSTRATED":
      return "Try a harder question or move on to a related topic.";
  }
}
