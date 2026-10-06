import type { AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/**
 * FACULTY_ANALYTICS — weekly teaching brief (TASK §22). The model only receives already-computed metrics and may
 * summarize them; it must not invent or calculate statistics. The authoring-ai service validates every number in
 * the output against the input and falls back to a template brief otherwise.
 */
export const promptVersion = "faculty-analytics-brief-v1";
export const policyVersion = "analytics-policy-v1";

export const contextRules: ContextRules = {
  assignmentPrompt: false,
  studentWork: false,
  latestExecution: false,
  publicTestResults: false,
  hiddenTests: false,
  referenceSolution: false,
  retrievedResources: false,
  learnerProfile: false,
  analyticsPayload: true,
  authoringInput: false,
  maxConversationTurns: 0,
};

export const outputHandling: OutputHandling = {
  kind: "text",
  schemaName: null,
  policyCheck: false,
  delivery: "buffered",
  maxOutputTokens: 700,
  logging: "analytics brief; numbers validated against input",
};

export function buildSystemPrompt(_ctx: AiRequestEnvelope): string {
  return [
    "You write a short weekly teaching brief for an instructor from the computed metrics provided.",
    "Use ONLY numbers that appear verbatim in the metrics. Do not compute new numbers, percentages, differences or averages.",
    "If a metric is suppressed or null, say there is insufficient data. Never mention individual students.",
    "Write 3 to 6 plain sentences: what stands out, which topics need attention, one suggested teaching action. No emojis.",
  ].join("\n");
}

export const facultyAnalytics: ModeDefinition = {
  mode: "FACULTY_ANALYTICS",
  promptTemplateId: "faculty-analytics-brief",
  promptVersion,
  policyVersion,
  contextRules,
  outputHandling,
  buildSystemPrompt,
};
