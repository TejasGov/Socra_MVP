import { describe, expect, it } from "vitest";
import { checkProtectedOutput, toDbOutcome, type PolicyCheckContext } from "@/server/ai/policy-check";

const reference = `def digit_sum(n):
    if n < 10:
        return n
    return n % 10 + digit_sum(n // 10)
`;

const student = `def digit_sum(n):
    if n < 10
        return n
    return digit_sum(n)
`;

const ctx: PolicyCheckContext = {
  hiddenTests: [{ name: "large_number_case", inputs: [[987654321], 987654321], expected: [45] }],
  referenceSolution: reference,
  entryPoint: "digit_sum",
  studentCode: student,
  publicCorpus: "Write digit_sum(n). Public tests: single digit (7 -> 7), two digits (42 -> 6)",
};

describe("protected policy check", () => {
  it("blocks replies that leak hidden-test inputs and expected values", () => {
    const r = checkProtectedOutput("Try digit_sum(987654321); it should return 45.", ctx);
    expect(r.outcome).toBe("BLOCK_AND_REGENERATE");
    expect(r.checks.find((c) => c.check === "hidden_test_leak")?.passed).toBe(false);
  });

  it("blocks hidden test names", () => {
    expect(checkProtectedOutput("Your code fails large_number_case.", ctx).outcome).toBe("BLOCK_AND_REGENERATE");
  });

  it("blocks a full solution", () => {
    const r = checkProtectedOutput(`Here you go:\n\`\`\`python\n${reference}\`\`\``, ctx);
    expect(r.outcome).toBe("BLOCK_AND_REGENERATE");
    expect(r.reasons.join(" ")).toMatch(/target function|reference/);
  });

  it("blocks a renamed solution that reproduces the reference algorithm", () => {
    const renamed = "```python\ndef f(x):\n    if x < 10:\n        return x\n    return x % 10 + f(x // 10)\n```";
    expect(checkProtectedOutput(renamed, ctx).outcome).toBe("BLOCK_AND_REGENERATE");
  });

  it("allows a mechanical syntax fix", () => {
    const r = checkProtectedOutput("Line 2 needs a colon:\n```python\n    if n < 10:\n```", ctx);
    expect(r.outcome).toBe("ALLOW");
    expect(r.checks.some((c) => c.check === "mechanical_fix" && c.passed)).toBe(true);
  });

  it("allows Socratic prose and values already visible to the student", () => {
    expect(checkProtectedOutput("What does digit_sum(42) return when you trace it? The public test expects 6.", ctx).outcome).toBe("ALLOW");
  });

  it("redacts very long code blocks", () => {
    const long = "```python\n" + Array.from({ length: 20 }, (_, i) => `x${i} = ${i}`).join("\n") + "\n```";
    const r = checkProtectedOutput(`Example:\n${long}`, ctx);
    expect(r.outcome).toBe("REDACT");
    expect(r.redactedReply).toContain("Code removed");
    expect(r.redactedReply).not.toContain("x19 = 19");
  });

  it("maps outcomes onto the PolicyOutcome enum", () => {
    expect(toDbOutcome("REDACT")).toBe("REVISE");
    expect(toDbOutcome("BLOCK_AND_REGENERATE")).toBe("BLOCK");
    expect(toDbOutcome("ALLOW")).toBe("ALLOW");
  });
});
