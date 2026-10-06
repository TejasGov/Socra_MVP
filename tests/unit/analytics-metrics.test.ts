import { describe, expect, it } from "vitest";
import {
  finalCorrectness,
  firstAttemptCorrectness,
  funnel,
  guidedRecovery,
  interventionDepth,
  isoWeek,
  metric,
  misconceptionPrevalence,
  retryImprovement,
  topicDifficulty,
  unresolvedShare,
  type StudentQuestionFact,
} from "@/server/domain/analytics/metrics";

const T0 = new Date("2026-09-01T10:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);

function fact(p: Partial<StudentQuestionFact> & { userId: string }): StudentQuestionFact {
  return {
    questionId: "q1",
    assignmentId: "a1",
    submitted: true,
    attempts: [],
    socraFirstAt: null,
    maxLevel: null,
    changedAfterSocra: false,
    ...p,
  };
}

const attempt = (n: number, fraction: number, h = n * 10, hash = `h${n}`) => ({
  attemptNumber: n,
  submittedAt: at(h),
  fraction,
  contentHash: hash,
});

describe("metric() small-n suppression", () => {
  it("suppresses below the threshold and keeps numerator/denominator", () => {
    expect(metric(3, 4, 5)).toEqual({
      numerator: 3,
      denominator: 4,
      value: null,
      suppressed: true,
    });
    expect(metric(3, 5, 5)).toEqual({
      numerator: 3,
      denominator: 5,
      value: 0.6,
      suppressed: false,
    });
    expect(metric(0, 0, 1)).toMatchObject({ value: null, suppressed: true });
  });
});

describe("correctness metrics", () => {
  const facts = [
    fact({ userId: "a", attempts: [attempt(1, 1)] }),
    fact({ userId: "b", attempts: [attempt(1, 0.5), attempt(2, 1)] }),
    fact({ userId: "c", attempts: [attempt(1, 0), attempt(2, 0.4)] }),
    fact({ userId: "d", attempts: [] }), // submitted, not graded: excluded from denominators
  ];

  it("first-attempt correctness = correct first graded attempt / students with one", () => {
    expect(firstAttemptCorrectness(facts, 1)).toMatchObject({ numerator: 1, denominator: 3 });
  });

  it("final correctness = correct latest graded attempt / students with a graded attempt", () => {
    expect(finalCorrectness(facts, 1)).toMatchObject({ numerator: 2, denominator: 3 });
  });

  it("final correctness is never below first-attempt correctness when students only improve", () => {
    const improving = [
      fact({ userId: "a", attempts: [attempt(1, 0.5), attempt(2, 1)] }),
      fact({ userId: "b", attempts: [attempt(1, 1)] }),
      fact({ userId: "c", attempts: [attempt(1, 0), attempt(2, 1), attempt(3, 1)] }),
    ];
    const first = firstAttemptCorrectness(improving, 1);
    const final = finalCorrectness(improving, 1);
    expect(first.numerator).toBe(1);
    expect(final.numerator).toBe(3);
    expect(final.numerator).toBeGreaterThanOrEqual(first.numerator);
  });

  it("retry improvement = improved later attempt / students with 2+ attempts", () => {
    expect(retryImprovement(facts, 1)).toMatchObject({ numerator: 2, denominator: 2, value: 1 });
  });

  it("is suppressed with the default threshold of 5", () => {
    expect(firstAttemptCorrectness(facts, 5)).toMatchObject({ suppressed: true, value: null });
  });
});

describe("guided recovery and intervention depth", () => {
  const facts = [
    // used Socra after first attempt, revised, correct
    fact({
      userId: "a",
      attempts: [attempt(1, 0, 1), attempt(2, 1, 5)],
      socraFirstAt: at(2),
      maxLevel: 3,
    }),
    // used Socra, resubmitted identical answer, no change events: not "revised"
    fact({
      userId: "b",
      attempts: [attempt(1, 0, 1, "same"), attempt(2, 0, 5, "same")],
      socraFirstAt: at(2),
      maxLevel: 5,
    }),
    // used Socra before first attempt and edited afterwards: revised, incorrect
    fact({
      userId: "c",
      attempts: [attempt(1, 0.5, 5)],
      socraFirstAt: at(1),
      maxLevel: 1,
      changedAfterSocra: true,
    }),
    // never used Socra
    fact({ userId: "d", attempts: [attempt(1, 1, 1)] }),
  ];

  it("guided recovery = correct after Socra + revision / Socra users who revised", () => {
    expect(guidedRecovery(facts, 1)).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("intervention depth = mean of per-task max level over tasks with Socra, plus max", () => {
    const d = interventionDepth(facts, 1);
    expect(d.denominator).toBe(3);
    expect(d.numerator).toBe(9);
    expect(d.value).toBe(3);
    expect(d.max).toBe(5);
    expect(interventionDepth(facts, 5)).toMatchObject({ suppressed: true, value: null, max: null });
  });
});

describe("prevalence, topic difficulty, unresolved", () => {
  it("counts unique observed students among eligible students", () => {
    expect(misconceptionPrevalence(["a", "a", "b", "z"], ["a", "b", "c", "d"], 1)).toMatchObject({
      numerator: 2,
      denominator: 4,
      value: 0.5,
    });
  });

  it("topic difficulty counts incorrect and heavily assisted outcomes", () => {
    const m = topicDifficulty(
      [
        { userId: "a", value: 1, sourceFactor: 1, independence: 1 }, // 0 difficulty
        { userId: "b", value: 1, sourceFactor: 0.7, independence: 0.25 }, // assisted success: 0.75
        { userId: "c", value: 0, sourceFactor: 1, independence: 1 }, // incorrect: 1
      ],
      1,
    );
    expect(m).toMatchObject({ numerator: 2, denominator: 3 });
  });

  it("unresolved share uses current Needs reinforcement states", () => {
    const states = [
      { state: "NEEDS_REINFORCEMENT" },
      { state: "DEVELOPING" },
      { state: "NEEDS_REINFORCEMENT" },
      { state: "CONSISTENTLY_DEMONSTRATED" },
    ];
    expect(unresolvedShare(states, 1)).toMatchObject({ numerator: 2, denominator: 4 });
    expect(unresolvedShare(states, 5).suppressed).toBe(true);
  });
});

describe("funnel and weeks", () => {
  it("is monotone (each step restricted to the previous)", () => {
    const steps = funnel({
      opened: new Set(["a", "b", "c"]),
      attempted: new Set(["a", "b", "x"]),
      askedSocra: new Set(["a", "c", "y"]),
      revised: new Set(["a", "c", "b"]),
      correctAfterRevision: new Set(["a", "b"]),
    });
    expect(steps.map((s) => s.count)).toEqual([4, 3, 2, 2, 1]);
  });

  it("computes ISO week keys", () => {
    expect(isoWeek(new Date("2026-10-06T12:00:00Z")).key).toBe("2026-W41");
    expect(isoWeek(new Date("2026-10-06T12:00:00Z")).start.toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
    expect(isoWeek(new Date("2021-01-03T12:00:00Z")).key).toBe("2020-W53");
  });
});
