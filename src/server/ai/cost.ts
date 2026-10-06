import type { AiUsage, ModelTier } from "./types";

/**
 * Price table (USD per 1M tokens) and request cost formula (digest §2.11 Appendix A).
 *
 *   cost = uncachedInput/1M * inputRate + cachedInput/1M * cachedRate + (output + reasoning)/1M * outputRate
 *
 * Reasoning tokens are billed as output. NOTE: providers report `outputTokens` INCLUSIVE of reasoning tokens
 * (OpenAI Responses usage), so the gateway passes `reasoningIncludedInOutput: true` for OpenAI; the mock reports
 * reasoningTokens = 0. Rates are env-overridable (AI_PRICE_* in src/server/env.ts).
 */
export interface PriceRates {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export type PriceTable = Record<ModelTier, PriceRates>;

/** Planning defaults: Sol $2/$10, Luna $0.10/$0.50, embeddings $0.02 (cached input at 10% of input). */
export const DEFAULT_PRICES: PriceTable = {
  protected: { inputPer1M: 2.0, cachedInputPer1M: 0.2, outputPer1M: 10.0 },
  economy: { inputPer1M: 0.1, cachedInputPer1M: 0.01, outputPer1M: 0.5 },
  embedding: { inputPer1M: 0.02, cachedInputPer1M: 0.02, outputPer1M: 0 },
};

export interface PriceEnv {
  AI_PRICE_PROTECTED_INPUT_PER_1M: number;
  AI_PRICE_PROTECTED_CACHED_INPUT_PER_1M: number;
  AI_PRICE_PROTECTED_OUTPUT_PER_1M: number;
  AI_PRICE_ECONOMY_INPUT_PER_1M: number;
  AI_PRICE_ECONOMY_CACHED_INPUT_PER_1M: number;
  AI_PRICE_ECONOMY_OUTPUT_PER_1M: number;
  AI_PRICE_EMBEDDING_PER_1M: number;
}

/** Build the price table from (validated) env values. */
export function priceTableFromEnv(e: PriceEnv): PriceTable {
  return {
    protected: {
      inputPer1M: e.AI_PRICE_PROTECTED_INPUT_PER_1M,
      cachedInputPer1M: e.AI_PRICE_PROTECTED_CACHED_INPUT_PER_1M,
      outputPer1M: e.AI_PRICE_PROTECTED_OUTPUT_PER_1M,
    },
    economy: {
      inputPer1M: e.AI_PRICE_ECONOMY_INPUT_PER_1M,
      cachedInputPer1M: e.AI_PRICE_ECONOMY_CACHED_INPUT_PER_1M,
      outputPer1M: e.AI_PRICE_ECONOMY_OUTPUT_PER_1M,
    },
    embedding: {
      inputPer1M: e.AI_PRICE_EMBEDDING_PER_1M,
      cachedInputPer1M: e.AI_PRICE_EMBEDDING_PER_1M,
      outputPer1M: 0,
    },
  };
}

/** Request cost in USD, rounded to 6 decimals (AiRequest.costUsd is Decimal(12,6)). */
export function computeCostUsd(
  usage: AiUsage,
  rates: PriceRates,
  opts: { reasoningIncludedInOutput?: boolean } = {},
): number {
  const cached = Math.max(0, Math.min(usage.cachedTokens, usage.inputTokens));
  const uncached = Math.max(0, usage.inputTokens - cached);
  const output = opts.reasoningIncludedInOutput
    ? usage.outputTokens
    : usage.outputTokens + usage.reasoningTokens;
  const cost =
    (uncached / 1_000_000) * rates.inputPer1M +
    (cached / 1_000_000) * rates.cachedInputPer1M +
    (output / 1_000_000) * rates.outputPer1M;
  return Math.round(cost * 1e6) / 1e6;
}

/** Embedding cost: tokens * rate. */
export function computeEmbeddingCostUsd(tokens: number, rates: PriceRates): number {
  return Math.round((tokens / 1_000_000) * rates.inputPer1M * 1e6) / 1e6;
}
