import "server-only";
import { env } from "../env";
import { MockAiProvider } from "./providers/mock";
import { OpenAiProvider } from "./providers/openai";
import type { AiProvider, AiTask, ModelTier } from "./types";

/**
 * Provider selection + model routing (engineering contract "Model routing").
 *
 * MockAiProvider when AI_MOCK_MODE (no OPENAI_API_KEY or forced), otherwise OpenAiProvider (Responses API,
 * store:false). Adding a key activates the real integration without code changes.
 */

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (provider) return provider;
  provider = env().AI_MOCK_MODE ? new MockAiProvider() : new OpenAiProvider();
  return provider;
}

/** Override for tests. */
export function setAiProviderForTests(p: AiProvider | undefined): void {
  provider = p;
}

/** Task -> model tier. Protected tutor model is fixed per study cohort; fallbacks never switch it silently. */
export const TASK_TIERS: Record<AiTask, ModelTier> = {
  socratic_turn: "protected",
  review_turn: "protected",
  authoring_generation: "protected",
  grading_suggestion: "protected",
  policy_check: "protected",
  practice_tutor_turn: "economy",
  practice_generation: "economy",
  practice_grading: "economy",
  misconception_extraction: "economy",
  topic_classification: "economy",
  analytics_brief: "economy",
  embedding: "embedding",
};

export function modelForTier(tier: ModelTier): string {
  const e = env();
  if (tier === "protected") return e.OPENAI_PROTECTED_MODEL;
  if (tier === "economy") return e.OPENAI_ECONOMY_MODEL;
  return e.OPENAI_EMBEDDING_MODEL;
}
