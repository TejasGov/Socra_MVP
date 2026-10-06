import { describe, expect, it } from "vitest";
import { buildProviderRequest, executeWithRetries } from "@/server/ai/gateway";
import { protectedTurnSchema } from "@/server/ai/schemas";
import { extractJson, toStructuredOutputSpec } from "@/server/ai/structured";
import { AiProviderError, type AiProvider, type AiResult } from "@/server/ai/types";
import { envelope } from "./helpers";

function fakeProvider(outputs: Array<string | AiProviderError>): AiProvider & { calls: number } {
  const p = {
    name: "MOCK" as const,
    calls: 0,
    async generate(): Promise<AiResult> {
      const out = outputs[Math.min(p.calls, outputs.length - 1)]!;
      p.calls++;
      if (out instanceof AiProviderError) throw out;
      return {
        text: out,
        usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 10, reasoningTokens: 0 },
        model: "fake",
        provider: "MOCK",
        providerRequestId: null,
        latencyMs: 1,
      };
    },
    async *stream() {},
    async embed() {
      return [];
    },
  };
  return p;
}

const valid = JSON.stringify({ reply: "What does line 2 do?", interventionLevel: 1, citedResourceIds: [], misconceptionCandidates: [] });
const req = () => buildProviderRequest(envelope(), { task: "socratic_turn", structured: protectedTurnSchema }).request;

describe("structured output handling", () => {
  it("retries once on malformed JSON, then reports INVALID_OUTPUT", async () => {
    const p = fakeProvider(["{not json", '{"reply": 3}']);
    const out = await executeWithRetries(p, req(), protectedTurnSchema);
    expect(out.ok).toBe(false);
    expect(out.errorClass).toBe("INVALID_OUTPUT");
    expect(out.structuredOutputValid).toBe(false);
    expect(p.calls).toBe(2);
    expect(out.usage.inputTokens).toBe(200); // both attempts are billed
  });

  it("recovers when the retry is valid", async () => {
    const p = fakeProvider(["oops", valid]);
    const out = await executeWithRetries(p, req(), protectedTurnSchema);
    expect(out.ok).toBe(true);
    expect(out.retryCount).toBe(1);
    expect(out.structured?.interventionLevel).toBe(1);
  });

  it("retries a transient provider error once and never throws", async () => {
    const p = fakeProvider([new AiProviderError("RATE_LIMITED", "429", true), valid]);
    expect((await executeWithRetries(p, req(), protectedTurnSchema)).ok).toBe(true);
    const down = fakeProvider([new AiProviderError("PROVIDER_UNAVAILABLE", "503", true)]);
    const out = await executeWithRetries(down, req(), protectedTurnSchema);
    expect(out.ok).toBe(false);
    expect(out.errorClass).toBe("PROVIDER_UNAVAILABLE");
    expect(down.calls).toBe(2);
  });

  it("does not retry non-transient errors", async () => {
    const p = fakeProvider([new AiProviderError("AUTH", "401", false)]);
    const out = await executeWithRetries(p, req(), protectedTurnSchema);
    expect(out.errorClass).toBe("AUTH");
    expect(p.calls).toBe(1);
  });

  it("extracts JSON from fenced output", () => {
    expect(extractJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("builds a strict JSON schema with every property required", () => {
    const spec = toStructuredOutputSpec("protected_turn", protectedTurnSchema);
    const schema = spec.schema as { required: string[]; additionalProperties: boolean };
    expect(spec.strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["reply", "interventionLevel", "citedResourceIds", "misconceptionCandidates"]);
  });
});
