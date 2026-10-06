import { describe, expect, it } from "vitest";
import {
  computeTopicState,
  evidenceWeight,
  independenceFactor,
  recencyFactor,
  type EvidenceObservation,
} from "@/server/domain/learner/topic-state";

const NOW = new Date("2026-10-06T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function obs(partial: Partial<EvidenceObservation> = {}): EvidenceObservation {
  return {
    evidenceType: "FIRST_ATTEMPT_CORRECTNESS",
    sourceType: "SUBMISSION",
    value: 1,
    occurredAt: daysAgo(1),
    assisted: false,
    maxInterventionLevel: 0,
    ...partial,
  };
}

describe("ltm-v1 weights", () => {
  it("halves weight every 21 days", () => {
    expect(recencyFactor(NOW, NOW)).toBe(1);
    expect(recencyFactor(daysAgo(21), NOW)).toBeCloseTo(0.5, 6);
    expect(recencyFactor(daysAgo(42), NOW)).toBeCloseTo(0.25, 6);
  });

  it("weights independent work above heavily assisted work", () => {
    expect(independenceFactor(0, false)).toBe(1);
    expect(independenceFactor(2, true)).toBe(0.85);
    expect(independenceFactor(4, true)).toBe(0.6);
    expect(independenceFactor(5, true)).toBe(0.4);
    expect(independenceFactor(6, true)).toBe(0.25);
    const a = evidenceWeight(obs({ occurredAt: NOW }), NOW)!;
    const b = evidenceWeight(
      obs({ occurredAt: NOW, maxInterventionLevel: 5, assisted: true }),
      NOW,
    )!;
    expect(a).toBe(1);
    expect(b).toBeCloseTo(0.4, 6);
  });

  it("applies source factors and ignores non-scoring evidence", () => {
    const at = { occurredAt: NOW };
    expect(evidenceWeight(obs({ ...at, evidenceType: "FINAL_CORRECTNESS" }), NOW)).toBeCloseTo(0.7);
    expect(
      evidenceWeight(obs({ ...at, evidenceType: "PRACTICE_SUCCESS", sourceType: "PRACTICE" }), NOW),
    ).toBeCloseTo(0.6);
    expect(evidenceWeight(obs({ ...at, evidenceType: "RETRY_IMPROVEMENT" }), NOW)).toBeCloseTo(0.5);
    expect(evidenceWeight(obs({ ...at, evidenceType: "SOCRA_USAGE" }), NOW)).toBeNull();
    expect(evidenceWeight(obs({ ...at, evidenceType: "MISCONCEPTION_OBSERVED" }), NOW)).toBeNull();
  });
});

describe("ltm-v1 states", () => {
  it("requires at least 4 observations before Consistently demonstrated", () => {
    const three = [obs(), obs(), obs()];
    expect(computeTopicState(three, NOW).state).toBe("DEVELOPING");
    const four = [...three, obs()];
    const r = computeTopicState(four, NOW);
    expect(r.state).toBe("CONSISTENTLY_DEMONSTRATED");
    expect(r.observationCount).toBe(4);
    expect(r.effectiveEvidence).toBeGreaterThanOrEqual(2);
  });

  it("requires effective evidence >= 2.0 (old or heavily assisted evidence is not enough)", () => {
    const assisted = Array.from({ length: 6 }, () =>
      obs({ maxInterventionLevel: 6, assisted: true }),
    );
    const r = computeTopicState(assisted, NOW);
    expect(r.score).toBeCloseTo(1, 6);
    expect(r.effectiveEvidence).toBeLessThan(2);
    expect(r.state).toBe("DEVELOPING");

    const old = Array.from({ length: 5 }, () => obs({ occurredAt: daysAgo(90) }));
    expect(computeTopicState(old, NOW).state).toBe("DEVELOPING");
  });

  it("marks Needs reinforcement only with at least 2 observations and score < 0.5", () => {
    expect(computeTopicState([obs({ value: 0 })], NOW).state).toBe("DEVELOPING");
    expect(computeTopicState([obs({ value: 0 }), obs({ value: 0 })], NOW).state).toBe(
      "NEEDS_REINFORCEMENT",
    );
  });

  it("recent evidence outweighs old evidence", () => {
    const recentGood = [
      obs({ value: 0, occurredAt: daysAgo(60) }),
      obs({ value: 0, occurredAt: daysAgo(60) }),
      obs({ value: 1, occurredAt: daysAgo(1) }),
      obs({ value: 1, occurredAt: daysAgo(1) }),
    ];
    expect(computeTopicState(recentGood, NOW).score).toBeGreaterThan(0.75);
  });

  it("independent success scores above assisted success with an earlier failure (student A vs B)", () => {
    const studentA = [obs({ value: 1 })];
    const studentB = [
      obs({ value: 0, maxInterventionLevel: 0 }),
      obs({ evidenceType: "FINAL_CORRECTNESS", value: 1, maxInterventionLevel: 5, assisted: true }),
      obs({ evidenceType: "RETRY_IMPROVEMENT", value: 1, maxInterventionLevel: 5, assisted: true }),
    ];
    const a = computeTopicState(studentA, NOW);
    const b = computeTopicState(studentB, NOW);
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.assistanceDependency).toBeGreaterThan(0);
    expect(a.lastDemonstratedAt).not.toBeNull();
  });

  it("is rebuildable: order-independent and deterministic", () => {
    const evidence = [
      obs({ value: 1, occurredAt: daysAgo(30) }),
      obs({ value: 0, occurredAt: daysAgo(20), maxInterventionLevel: 3, assisted: true }),
      obs({
        evidenceType: "PRACTICE_SUCCESS",
        sourceType: "PRACTICE",
        value: 1,
        occurredAt: daysAgo(3),
      }),
      obs({
        evidenceType: "MISCONCEPTION_OBSERVED",
        value: 1,
        misconceptionLabel: "Missing base case",
      }),
      obs({
        evidenceType: "MISCONCEPTION_OBSERVED",
        value: 1,
        misconceptionLabel: "Missing base case",
      }),
      obs({ evidenceType: "MISCONCEPTION_OBSERVED", value: 1, misconceptionLabel: "Off by one" }),
    ];
    const a = computeTopicState(evidence, NOW);
    const b = computeTopicState([...evidence].reverse(), NOW);
    expect(b).toEqual(a);
    expect(a.commonDifficulty).toBe("Missing base case");
    expect(a.algorithmVersion).toBe("ltm-v1");
  });

  it("ignores evidence after asOf", () => {
    const future = [obs({ value: 0, occurredAt: new Date(NOW.getTime() + 86_400_000) })];
    expect(computeTopicState(future, NOW).observationCount).toBe(0);
  });

  it("reports confidence from effective evidence and a trajectory from the last 14 days", () => {
    expect(computeTopicState([obs({ occurredAt: daysAgo(40) })], NOW).confidence).toBe("LOW");
    const improving = [
      obs({ value: 0, occurredAt: daysAgo(30) }),
      obs({ value: 0, occurredAt: daysAgo(25) }),
      obs({ value: 1, occurredAt: daysAgo(3) }),
      obs({ value: 1, occurredAt: daysAgo(2) }),
    ];
    const r = computeTopicState(improving, NOW);
    expect(r.trajectory).toBe("IMPROVING");
    expect(["MEDIUM", "HIGH"]).toContain(r.confidence);
  });
});
