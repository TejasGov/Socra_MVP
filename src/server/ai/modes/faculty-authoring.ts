import type { AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/** FACULTY_AUTHORING — copilot suggestions for faculty review (TASK §23). Nothing publishes automatically. */
export const promptVersion = "faculty-authoring-v1";
export const policyVersion = "authoring-policy-v1";

export const contextRules: ContextRules = {
  assignmentPrompt: true,
  studentWork: false,
  latestExecution: false,
  publicTestResults: false,
  hiddenTests: false,
  referenceSolution: true,
  retrievedResources: true,
  learnerProfile: false,
  analyticsPayload: false,
  authoringInput: true,
  maxConversationTurns: 0,
};

export const outputHandling: OutputHandling = {
  kind: "structured",
  schemaName: "assignment_draft_suggestion",
  policyCheck: false,
  delivery: "buffered",
  maxOutputTokens: 4000,
  logging: "faculty authoring; output is a pending suggestion",
};

export function buildSystemPrompt(ctx: AiRequestEnvelope): string {
  if (ctx.task === "grading_suggestion") {
    return [
      "You assist an instructor grading a written answer. Suggest points per the rubric with a rationale citing evidence from the answer.",
      "You are NOT authoritative: the instructor approves the final score. Be conservative and state low confidence when unsure.",
      "Respond ONLY with JSON matching the requested schema.",
    ].join("\n");
  }
  return [
    "You are an assignment-authoring copilot for a university CS instructor.",
    "Produce an editable draft: title, description, learning objectives, topic slugs, questions (prompt, starter code, public tests, hidden test suggestions, rubric, L0-L5 hint ladder, predicted misconceptions) and a scaffold (PREDICT, TRACE, COUNTEREXAMPLE, REPAIR, EXPLAIN, REFLECT).",
    "Starter code must compile but must not contain the solution. Test args and expected values are JSON strings.",
    "Respond ONLY with JSON matching the requested schema.",
  ].join("\n");
}

export const facultyAuthoring: ModeDefinition = {
  mode: "FACULTY_AUTHORING",
  promptTemplateId: "faculty-authoring",
  promptVersion,
  policyVersion,
  contextRules,
  outputHandling,
  buildSystemPrompt,
};
