import { describe, expect, it } from "vitest";
import {
  clampPoints,
  computeRubricPoints,
  computeTestPoints,
  isPurelyDeterministic,
  overallStatus,
  resolveFinalScore,
  testFraction,
  testPointsAvailable,
} from "@/server/domain/grading/score";
import { assignmentInputSchema } from "@/server/domain/assignments/schema";
import { hasBlockingIssues, validateForPublish } from "@/server/domain/assignments/validation";

describe("weighted test scoring", () => {
  it("weights matter", () => {
    const r = [
      { weight: 1, passed: true },
      { weight: 3, passed: false },
    ];
    expect(testFraction(r)).toBeCloseTo(0.25);
    expect(computeTestPoints(r, 20)).toBe(5);
  });

  it("all passed gives full points; none gives zero", () => {
    expect(
      computeTestPoints(
        [
          { weight: 2, passed: true },
          { weight: 2, passed: true },
        ],
        10,
      ),
    ).toBe(10);
    expect(computeTestPoints([{ weight: 2, passed: false }], 10)).toBe(0);
  });

  it("zero total weight scores zero rather than dividing by zero", () => {
    expect(computeTestPoints([{ weight: 0, passed: true }], 10)).toBe(0);
    expect(computeTestPoints([], 10)).toBe(0);
  });

  it("rounds to two decimals", () => {
    expect(
      computeTestPoints(
        [
          { weight: 1, passed: true },
          { weight: 2, passed: false },
        ],
        10,
      ),
    ).toBe(3.33);
  });

  it("rubric criteria reserve points that tests cannot award", () => {
    const criteria = [{ maxPoints: 4 }];
    expect(testPointsAvailable(10, criteria)).toBe(6);
    expect(computeTestPoints([{ weight: 1, passed: true }], 10, criteria)).toBe(6);
    expect(testPointsAvailable(3, criteria)).toBe(0);
  });
});

describe("rubric scoring", () => {
  const criteria = [
    { id: "a", maxPoints: 3 },
    { id: "b", maxPoints: 2 },
  ];
  it("sums and clamps each criterion", () => {
    expect(computeRubricPoints(criteria, { a: 2, b: 1 })).toBe(3);
    expect(computeRubricPoints(criteria, { a: 9, b: -4 })).toBe(3);
  });
  it("ignores unscored and non-finite values", () => {
    expect(computeRubricPoints(criteria, { a: Number.NaN })).toBe(0);
    expect(computeRubricPoints(criteria, {})).toBe(0);
  });
});

describe("final score and override", () => {
  it("without override, final equals computed (tests + rubric)", () => {
    expect(resolveFinalScore({ maxPoints: 10, testPoints: 6, rubricPoints: 3 })).toEqual({
      computed: 9,
      final: 9,
      overridden: false,
    });
  });
  it("an override replaces the computed score and is flagged", () => {
    expect(
      resolveFinalScore({ maxPoints: 10, testPoints: 6, rubricPoints: 3, override: 10 }),
    ).toEqual({
      computed: 9,
      final: 10,
      overridden: true,
    });
  });
  it("an override equal to computed is not an override", () => {
    expect(
      resolveFinalScore({ maxPoints: 10, testPoints: 6, rubricPoints: 3, override: 9 }).overridden,
    ).toBe(false);
  });
  it("clamps to the question maximum", () => {
    expect(resolveFinalScore({ maxPoints: 10, testPoints: 10, rubricPoints: 5 }).final).toBe(10);
    expect(
      resolveFinalScore({ maxPoints: 10, testPoints: 0, rubricPoints: 0, override: 99 }).final,
    ).toBe(10);
    expect(clampPoints(-3, 5)).toBe(0);
  });
});

describe("grade status", () => {
  it("pure deterministic coding is final; rubric or written needs a person", () => {
    expect(
      isPurelyDeterministic({ type: "CODING", rubricCriteria: 0, hasGradableTests: true }),
    ).toBe(true);
    expect(
      isPurelyDeterministic({ type: "CODING", rubricCriteria: 2, hasGradableTests: true }),
    ).toBe(false);
    expect(
      isPurelyDeterministic({ type: "ESSAY", rubricCriteria: 0, hasGradableTests: false }),
    ).toBe(false);
    expect(
      isPurelyDeterministic({ type: "CODING", rubricCriteria: 0, hasGradableTests: false }),
    ).toBe(false);
  });
  it("overall status is the weakest question status", () => {
    expect(overallStatus(["FINAL", "FINAL"])).toBe("FINAL");
    expect(overallStatus(["FINAL", "SUGGESTED"])).toBe("SUGGESTED");
    expect(overallStatus(["SUGGESTED", "PENDING"])).toBe("PENDING");
    expect(overallStatus([])).toBe("PENDING");
  });
});

describe("publish validation", () => {
  const base = () =>
    assignmentInputSchema.parse({
      courseId: "c1",
      title: "Recursion",
      format: "CODING",
      language: "PYTHON",
      questions: [
        {
          title: "Sum list",
          prompt: "Sum a list",
          type: "CODING",
          points: 10,
          entryPoint: "total",
          tests: [
            { name: "t1", visibility: "PUBLIC", weight: 1, args: [[1, 2]], expectedReturn: 3 },
          ],
        },
      ],
      dueAt: "2026-11-01T12:00:00Z",
      closeAt: "2026-11-02T12:00:00Z",
    });

  it("a complete assignment has no blocking issues", () => {
    expect(hasBlockingIssues(validateForPublish(base()))).toBe(false);
  });
  it("requires a question, tests and positive points", () => {
    const none = { ...base(), questions: [] };
    expect(hasBlockingIssues(validateForPublish(none))).toBe(true);
    const b = base();
    b.questions[0]!.tests = [];
    expect(
      validateForPublish(b).some((i) => i.path === "questions.0.tests" && i.severity === "error"),
    ).toBe(true);
    const z = base();
    z.questions[0]!.points = 0;
    expect(hasBlockingIssues(validateForPublish(z))).toBe(true);
  });
  it("rejects a close date before the due date and rubric above question points", () => {
    const b = base();
    b.closeAt = new Date("2026-10-01T00:00:00Z");
    expect(hasBlockingIssues(validateForPublish(b))).toBe(true);
    const r = base();
    r.questions[0]!.rubric = [{ title: "Style", description: "", maxPoints: 11 }];
    expect(
      validateForPublish(r).some((i) => i.path === "questions.0.rubric" && i.severity === "error"),
    ).toBe(true);
  });
});
