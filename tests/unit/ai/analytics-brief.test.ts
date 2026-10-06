import { describe, expect, it } from "vitest";
import { mockAnalyticsBrief } from "@/server/ai/providers/mock-modes";
import { inventedNumbers } from "@/server/domain/authoring-ai";
import type { AiRequestEnvelope } from "@/server/ai/types";

const m = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
  suppressed: false,
});

const payload = {
  activeStudents: m(21, 21),
  completion: m(47, 84),
  firstAttemptCorrectness: m(87, 102),
  finalCorrectness: m(89, 102),
  guidedRecovery: m(16, 16),
  interventionDepth: { ...m(60, 21), max: 5 },
  painPoints: [{ name: "Recursion", difficulty: m(3, 19) }],
  misconceptions: [
    { label: "Skips the base case", topicName: "Recursion", prevalence: m(4, 20) },
    { label: "Mixes up indexes", topicName: "Lists", prevalence: m(2, 20) },
  ],
  assignments: [{ title: "HW4", completion: m(7, 21) }],
};

describe("mock analytics brief", () => {
  const text = mockAnalyticsBrief({ analyticsPayload: payload } as unknown as AiRequestEnvelope);

  it("reads as a short note with denominators and an average depth", () => {
    expect(text).toContain("47 of 84 student-assignments have been submitted (56%)");
    expect(text).toContain("average");
    expect(text).not.toContain("60 of 21");
    expect(text).toContain("Recursion");
    expect(text).toContain("Skips the base case");
    expect(text.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(3);
  });

  it("uses only numbers present in the metrics and no causal language", () => {
    expect(inventedNumbers(text, payload)).toEqual([]);
    expect(text).not.toMatch(/because|caused|due to|led to/i);
  });
});
