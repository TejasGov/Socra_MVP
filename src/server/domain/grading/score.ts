/**
 * Grading math (TASK §24, PRD §15). Pure functions, unit-tested.
 *
 * Coding question with `points` P and optional manual rubric criteria totalling R:
 *   test points   = (P - R) * (sum of weights of passed tests / sum of all test weights)
 *   rubric points = sum of criterion scores, each clamped to [0, criterion max]
 *   computed      = test points + rubric points
 * A question with no rubric criteria is purely deterministic (status FINAL). With criteria the grade stays SUGGESTED
 * until a faculty member scores them and finalizes. An instructor override replaces `computed`; it is audited.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface WeightedResult {
  weight: number;
  passed: boolean;
}

export function testFraction(results: readonly WeightedResult[]): number {
  const total = results.reduce((s, r) => s + Math.max(0, r.weight), 0);
  if (total <= 0) return 0;
  const passed = results.reduce((s, r) => s + (r.passed ? Math.max(0, r.weight) : 0), 0);
  return passed / total;
}

export function rubricMax(criteria: ReadonlyArray<{ maxPoints: number }>): number {
  return criteria.reduce((s, c) => s + Math.max(0, c.maxPoints), 0);
}

/** Points available to tests after the rubric portion is reserved. Never negative. */
export function testPointsAvailable(
  points: number,
  criteria: ReadonlyArray<{ maxPoints: number }>,
): number {
  return Math.max(0, points - rubricMax(criteria));
}

export function computeTestPoints(
  results: readonly WeightedResult[],
  points: number,
  criteria: ReadonlyArray<{ maxPoints: number }> = [],
): number {
  return round2(testPointsAvailable(points, criteria) * testFraction(results));
}

/** Sum of scores clamped to each criterion's range. Unscored criteria count as zero. */
export function computeRubricPoints(
  criteria: ReadonlyArray<{ id: string; maxPoints: number }>,
  scores: Readonly<Record<string, number>>,
): number {
  return round2(
    criteria.reduce((s, c) => {
      const v = scores[c.id];
      if (typeof v !== "number" || !Number.isFinite(v)) return s;
      return s + Math.min(Math.max(0, v), c.maxPoints);
    }, 0),
  );
}

export function clampPoints(value: number, max: number): number {
  return round2(Math.min(Math.max(0, value), max));
}

export interface FinalScoreInput {
  maxPoints: number;
  testPoints: number;
  rubricPoints: number;
  /** Instructor override of the whole question score (replaces the computed score). */
  override?: number | null;
}

export interface FinalScore {
  computed: number;
  final: number;
  overridden: boolean;
}

export function resolveFinalScore(input: FinalScoreInput): FinalScore {
  const computed = clampPoints(input.testPoints + input.rubricPoints, input.maxPoints);
  if (input.override === undefined || input.override === null) {
    return { computed, final: computed, overridden: false };
  }
  const final = clampPoints(input.override, input.maxPoints);
  return { computed, final, overridden: final !== computed };
}

/** Whether a question's grade can be final without a person (no manual criteria, deterministic tests only). */
export function isPurelyDeterministic(args: {
  type: "CODING" | "SHORT_ANSWER" | "ESSAY" | "MULTIPLE_CHOICE";
  rubricCriteria: number;
  hasGradableTests: boolean;
}): boolean {
  return args.type === "CODING" && args.rubricCriteria === 0 && args.hasGradableTests;
}

export type QuestionGradeStatus = "PENDING" | "SUGGESTED" | "FINAL";

/** Overall submission status from its question grades: any PENDING -> PENDING; else any SUGGESTED -> SUGGESTED. */
export function overallStatus(statuses: readonly QuestionGradeStatus[]): QuestionGradeStatus {
  if (statuses.length === 0) return "PENDING";
  if (statuses.includes("PENDING")) return "PENDING";
  if (statuses.includes("SUGGESTED")) return "SUGGESTED";
  return "FINAL";
}
