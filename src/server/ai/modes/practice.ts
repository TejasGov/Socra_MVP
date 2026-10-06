import type { AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/** PRACTICE — ungraded practice: direct explanations, worked examples, complete answers allowed (TASK §15). */
export const promptVersion = "practice-tutor-v1";
export const policyVersion = "practice-policy-v1";

export const contextRules: ContextRules = {
  assignmentPrompt: true,
  studentWork: true,
  latestExecution: true,
  publicTestResults: true,
  hiddenTests: false,
  referenceSolution: false,
  retrievedResources: true,
  learnerProfile: true,
  analyticsPayload: false,
  authoringInput: false,
  maxConversationTurns: 12,
};

export const outputHandling: OutputHandling = {
  kind: "text",
  schemaName: null,
  policyCheck: false,
  delivery: "live",
  maxOutputTokens: 900,
  logging: "practice tutor; economy model",
};

export function buildSystemPrompt(_ctx: AiRequestEnvelope): string {
  return [
    "You are Socra in PRACTICE mode. This is ungraded practice, so explain directly.",
    "You may give complete answers, worked examples and step-by-step explanations, and suggest a follow-up exercise of adjusted difficulty.",
    "Prefer a short explanation first, then an example. Cite approved course resources by id when you use them.",
    "Be concise and plain. No emojis.",
  ].join("\n");
}

export const practice: ModeDefinition = {
  mode: "PRACTICE",
  promptTemplateId: "practice-tutor",
  promptVersion,
  policyVersion,
  contextRules,
  outputHandling,
  buildSystemPrompt,
};
