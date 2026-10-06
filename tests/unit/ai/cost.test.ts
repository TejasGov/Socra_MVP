import { describe, expect, it } from "vitest";
import { computeCostUsd, computeEmbeddingCostUsd, DEFAULT_PRICES, priceTableFromEnv } from "@/server/ai/cost";
import { parseEnv } from "@/server/env";

describe("cost accounting", () => {
  it("prices Sol at $2 in / $10 out per 1M", () => {
    // 3K in + 500 out = $0.011 (digest §2.11)
    expect(computeCostUsd({ inputTokens: 3000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 0 }, DEFAULT_PRICES.protected)).toBeCloseTo(0.011, 6);
  });

  it("prices Luna at $0.10 / $0.50 per 1M", () => {
    expect(computeCostUsd({ inputTokens: 3000, cachedTokens: 0, outputTokens: 500, reasoningTokens: 0 }, DEFAULT_PRICES.economy)).toBeCloseTo(0.00055, 6);
  });

  it("bills cached input at the cached rate", () => {
    const c = computeCostUsd({ inputTokens: 12_000, cachedTokens: 10_000, outputTokens: 0, reasoningTokens: 0 }, DEFAULT_PRICES.protected);
    expect(c).toBeCloseTo((2000 / 1e6) * 2 + (10_000 / 1e6) * 0.2, 6);
  });

  it("bills reasoning as output unless already included", () => {
    const u = { inputTokens: 0, cachedTokens: 0, outputTokens: 1000, reasoningTokens: 1000 };
    expect(computeCostUsd(u, DEFAULT_PRICES.protected)).toBeCloseTo(0.02, 6);
    expect(computeCostUsd(u, DEFAULT_PRICES.protected, { reasoningIncludedInOutput: true })).toBeCloseTo(0.01, 6);
  });

  it("embeddings cost $0.02 per 1M tokens", () => {
    expect(computeEmbeddingCostUsd(5_000_000, DEFAULT_PRICES.embedding)).toBeCloseTo(0.1, 6);
  });

  it("rates are env-overridable", () => {
    const e = parseEnv({ AI_PRICE_PROTECTED_INPUT_PER_1M: "4", AI_PRICE_PROTECTED_OUTPUT_PER_1M: "20" });
    const t = priceTableFromEnv(e);
    expect(t.protected.inputPer1M).toBe(4);
    expect(t.protected.outputPer1M).toBe(20);
    expect(priceTableFromEnv(parseEnv({})).economy).toEqual(DEFAULT_PRICES.economy);
  });
});
