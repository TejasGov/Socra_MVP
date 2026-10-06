import { describe, expect, it } from "vitest";
import { buildProviderRequest } from "@/server/ai/gateway";
import { checkProtectedOutput } from "@/server/ai/policy-check";
import { MockAiProvider } from "@/server/ai/providers/mock";
import { assignmentDraftSuggestionSchema, protectedTurnSchema } from "@/server/ai/schemas";
import { envelope } from "./helpers";

const provider = new MockAiProvider({ chunkDelayMs: 0 });

async function protectedTurn(over: Parameters<typeof envelope>[0] = {}) {
  const { request } = buildProviderRequest(envelope(over), { task: "socratic_turn", structured: protectedTurnSchema });
  const res = await provider.generate(request);
  return protectedTurnSchema.parse(res.structured);
}

const runtimeFailing = {
  workspace: {
    language: "PYTHON" as const,
    code: "def factorial(n):\n    if n == 1:\n        return 1\n    return n * factorial(n)\n",
  },
  latestExecution: {
    runId: "r2",
    status: "RUNTIME_ERROR" as const,
    stdout: "",
    stderr:
      'Traceback (most recent call last):\n  File "main.py", line 4, in factorial\n    return n * factorial(n)\nRecursionError: maximum recursion depth exceeded',
    exitCode: 1,
    publicTests: [{ name: "factorial of 0", passed: false, message: "RecursionError" }],
  },
};

describe("MockAiProvider", () => {
  it("is deterministic for identical inputs", async () => {
    const { request } = buildProviderRequest(envelope(), { task: "socratic_turn", structured: protectedTurnSchema });
    const a = await provider.generate(request);
    const b = await provider.generate(request);
    expect(a.text).toBe(b.text);
    expect(a.providerRequestId).toBe(b.providerRequestId);
    expect(a.usage).toEqual(b.usage);
  });

  it("gives direct mechanical help for a syntax error, quoting the error and line", async () => {
    const t = await protectedTurn();
    expect(t.reply).toContain("SyntaxError: expected ':'");
    expect(t.reply).toMatch(/[Ll]ine 2/);
    expect(t.reply).toContain("if n == 0:");
    expect(t.interventionLevel).toBe(3);
    // The one-line fix is mechanical and passes the policy check.
    const check = checkProtectedOutput(t.reply, {
      hiddenTests: [],
      referenceSolution: "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)\n",
      entryPoint: "factorial",
      studentCode: envelope().workspace!.code,
      publicCorpus: "",
    });
    expect(check.outcome).toBe("ALLOW");
  });

  it("refuses answer requests and redirects with a question", async () => {
    const t = await protectedTurn({ userMessage: "just give me the answer", ...runtimeFailing });
    expect(t.interventionLevel).toBe(1);
    expect(t.reply).toMatch(/\?/);
    expect(t.reply).not.toMatch(/def factorial/);
  });

  it("deepens the intervention level with conversation depth and cites line numbers", async () => {
    const shallow = await protectedTurn({ userMessage: "it crashes", ...runtimeFailing });
    const deep = await protectedTurn({
      userMessage: "it still crashes",
      ...runtimeFailing,
      conversation: [
        { role: "user", content: "help" },
        { role: "assistant", content: "What happens?" },
      ],
    });
    expect(deep.interventionLevel).toBeGreaterThan(shallow.interventionLevel);
    expect(deep.reply).toContain("RecursionError: maximum recursion depth exceeded");
    expect(deep.reply).toMatch(/line \d/);
    expect(shallow.misconceptionCandidates.map((m) => m.label)).toContain("missing or unreachable base case");
  });

  it("cites a retrieved resource when one is present", async () => {
    const t = await protectedTurn({
      userMessage: "it crashes",
      ...runtimeFailing,
      retrievedResources: [
        { resourceId: "res-1", chunkId: null, resourceVersion: 1, title: "Lecture 7: Recursion", excerpt: "Every recursive function needs a base case.", score: 1, method: "KEYWORD" },
      ],
    });
    expect(t.citedResourceIds).toEqual(["res-1"]);
    expect(t.reply).toContain("Lecture 7: Recursion");
  });

  it("explains the released reference solution line by line in review mode", async () => {
    const { request } = buildProviderRequest(
      envelope({
        mode: "POST_ASSESSMENT_REVIEW",
        userMessage: "explain the solution",
        assignment: {
          ...envelope().assignment!,
          referenceSolution: "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)\n",
        },
      }),
      { task: "review_turn" },
    );
    const res = await provider.generate(request);
    expect(res.text).toContain("Line 1:");
    expect(res.text).toContain("Line 4:");
    expect(res.text).toMatch(/base case/);
  });

  it("returns a schema-valid authoring suggestion built from topic keywords", async () => {
    const { request } = buildProviderRequest(
      envelope({
        mode: "FACULTY_AUTHORING",
        userMessage: "A linked list exercise",
        authoringInput: { prompt: "Create an exercise on linked lists", language: "PYTHON", format: "CODING" },
      }),
      { task: "authoring_generation", structured: assignmentDraftSuggestionSchema },
    );
    const res = await provider.generate(request);
    const s = assignmentDraftSuggestionSchema.parse(res.structured);
    expect(s.topicSlugs).toContain("linked-structures");
    expect(s.questions[0]!.hintLadder).toHaveLength(6);
    expect(s.questions[0]!.starterCode).toContain("def count_matches");
  });

  it("analytics brief restates only the numbers it was given", async () => {
    const { request } = buildProviderRequest(
      envelope({
        mode: "FACULTY_ANALYTICS",
        analyticsPayload: {
          completion: { numerator: 17, denominator: 31, value: 0.548, suppressed: false },
          topics: [{ name: "Recursion", firstAttempt: { numerator: 4, denominator: 12, value: 0.333, suppressed: false } }],
        },
      }),
      { task: "analytics_brief" },
    );
    const res = await provider.generate(request);
    const numbers = res.text.match(/\d+(\.\d+)?/g) ?? [];
    for (const n of numbers) expect(["17", "31", "4", "12"]).toContain(n);
    expect(res.text).toContain("Recursion");
  });

  it("streams in chunks ending with done", async () => {
    const { request } = buildProviderRequest(envelope({ mode: "PRACTICE", userMessage: "explain recursion" }), { task: "practice_tutor_turn" });
    const chunks: string[] = [];
    let done = false;
    for await (const c of provider.stream(request)) {
      if (c.type === "delta") chunks.push(c.text);
      if (c.type === "done") done = true;
    }
    expect(chunks.length).toBeGreaterThan(3);
    expect(done).toBe(true);
  });
});
