import type { AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/**
 * POST_ASSESSMENT_REVIEW — assignment CLOSED and solutions released by the instructor (TASK §9). The reference
 * solution is in context and complete explanations are allowed. Hidden tests are still excluded.
 */
export const promptVersion = "post-assessment-review-v1";
export const policyVersion = "review-policy-v1";

export const contextRules: ContextRules = {
  assignmentPrompt: true,
  studentWork: true,
  latestExecution: true,
  publicTestResults: true,
  hiddenTests: false,
  referenceSolution: true,
  retrievedResources: true,
  learnerProfile: false,
  analyticsPayload: false,
  authoringInput: false,
  maxConversationTurns: 12,
};

export const outputHandling: OutputHandling = {
  kind: "text",
  schemaName: null,
  policyCheck: false,
  delivery: "live",
  maxOutputTokens: 1400,
  logging: "post-assessment review; solutions released",
};

export function buildSystemPrompt(_ctx: AiRequestEnvelope): string {
  return [
    "You are Socra in REVIEW mode. The assignment is closed and the instructor released the solution.",
    "You may explain the complete reference solution line by line and compare it with the student's submitted approach.",
    "Point out what the student's version did differently and why it matters. Hidden tests are not available; do not speculate about them.",
    "Be clear and plain. No emojis.",
  ].join("\n");
}

export const postAssessmentReview: ModeDefinition = {
  mode: "POST_ASSESSMENT_REVIEW",
  promptTemplateId: "post-assessment-review",
  promptVersion,
  policyVersion,
  contextRules,
  outputHandling,
  buildSystemPrompt,
};
