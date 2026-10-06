import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAi, streamAi } from "@/server/ai/gateway";
import { persistPolicyDecision } from "@/server/ai/policy-check";
import { setAiProviderForTests } from "@/server/ai/provider";
import { MockAiProvider } from "@/server/ai/providers/mock";
import { protectedTurnSchema } from "@/server/ai/schemas";
import { disconnectPrisma, prisma } from "@/server/db";
import { envelope } from "../unit/ai/helpers";

const RUN = randomUUID().slice(0, 8);

beforeAll(() => setAiProviderForTests(new MockAiProvider({ chunkDelayMs: 0 })));
afterAll(async () => {
  setAiProviderForTests(undefined);
  await prisma.aiRequest.deleteMany({ where: { traceId: { startsWith: `itest-ai-${RUN}` } } });
  await disconnectPrisma();
});

describe("AI gateway (mock provider)", () => {
  it("runAi validates structured output and persists an AiRequest row", async () => {
    const traceId = `itest-ai-${RUN}-run`;
    const res = await runAi(envelope({ traceId, courseId: `itest_course_${RUN}` }), {
      task: "socratic_turn",
      schema: protectedTurnSchema,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.structured?.reply).toContain("SyntaxError");
    const row = await prisma.aiRequest.findUniqueOrThrow({ where: { id: res.aiRequestId } });
    expect(row).toMatchObject({
      traceId,
      provider: "MOCK",
      model: "mock-protected",
      mode: "PROTECTED_ASSESSMENT",
      task: "socratic_turn",
      status: "SUCCEEDED",
      promptVersion: "protected-socratic-v1",
      policyVersion: "protected-policy-v1",
      structuredOutputValid: true,
      retryCount: 0,
      errorClass: null,
    });
    expect(row.providerRequestId).toMatch(/^mock_/);
    expect(row.inputTokens).toBeGreaterThan(0);
    expect(row.outputTokens).toBeGreaterThan(0);
    expect(row.appVersion).toBeTruthy();
    expect(row.latencyMs).not.toBeNull();
    // Sol rates: $2 in / $10 out per 1M.
    const expected = (row.inputTokens * 2 + row.outputTokens * 10) / 1e6;
    expect(Number(row.costUsd)).toBeCloseTo(expected, 5);
  });

  it("streamAi yields deltas and persists the request on completion", async () => {
    const traceId = `itest-ai-${RUN}-stream`;
    let text = "";
    let aiRequestId: string | undefined;
    for await (const c of streamAi(envelope({ traceId, mode: "PRACTICE", task: "practice_tutor_turn", userMessage: "explain recursion" }), {
      task: "practice_tutor_turn",
    })) {
      if (c.type === "delta") text += c.text;
      if (c.type === "done") aiRequestId = c.result.aiRequestId;
      expect(c.type).not.toBe("error");
    }
    expect(text).toMatch(/base case/);
    const row = await prisma.aiRequest.findUniqueOrThrow({ where: { id: aiRequestId! } });
    expect(row).toMatchObject({ status: "SUCCEEDED", model: "mock-economy", mode: "PRACTICE" });
    expect(Number(row.costUsd)).toBeGreaterThan(0);
  });

  it("persists a PolicyDecision with the mapped outcome", async () => {
    const id = await persistPolicyDecision({
      sessionId: null,
      aiRequestId: null,
      mode: "PROTECTED_ASSESSMENT",
      policyVersion: "protected-policy-v1",
      outcome: "BLOCK_AND_REGENERATE",
      checks: [{ check: "target_function", passed: false, detail: "test" }],
      reasons: ["test"],
      interventionLevel: 2,
    });
    expect(id).toBeTruthy();
    const row = await prisma.policyDecision.findUniqueOrThrow({ where: { id: id! } });
    expect(row.outcome).toBe("BLOCK");
    await prisma.policyDecision.delete({ where: { id: id! } });
  });
});
