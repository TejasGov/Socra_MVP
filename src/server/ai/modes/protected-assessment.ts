import { INTERVENTION_LEVEL_LABELS, type AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/**
 * PROTECTED_ASSESSMENT — Socratic tutoring during an open assessment (TASK §11, PRD §10.6–10.7).
 * Hidden tests and the reference solution are never in context. Output is structured (reply + level + citations +
 * misconception candidates), validated, policy-checked, and only then released to the student.
 */
export const promptVersion = "protected-socratic-v1";
export const policyVersion = "protected-policy-v1";
/** Research condition UNRESTRICTED_AI: direct help, logged with its own policy version. */
export const unrestrictedPolicyVersion = "unrestricted-direct-v1";

export const contextRules: ContextRules = {
  assignmentPrompt: true,
  studentWork: true,
  latestExecution: true,
  publicTestResults: true,
  hiddenTests: false,
  referenceSolution: false,
  retrievedResources: true,
  learnerProfile: false,
  analyticsPayload: false,
  authoringInput: false,
  maxConversationTurns: 16,
};

export const outputHandling: OutputHandling = {
  kind: "structured",
  schemaName: "protected_turn",
  policyCheck: true,
  delivery: "buffered",
  maxOutputTokens: 900,
  logging: "protected tutor; fixed study model; policy-checked",
};

const LADDER = Object.entries(INTERVENTION_LEVEL_LABELS)
  .map(([lvl, label]) => `L${lvl} ${label}`)
  .join("; ");

export const MAY = [
  "inspect the student's current code and written answer",
  "interpret run results and PUBLIC test output",
  "explain syntax, compile and runtime errors, quoting the actual error message",
  "point to a suspicious line by number",
  "explain the relevant computer science concept",
  "analyze algorithmic complexity",
  "ask the student to trace execution on a small input",
  "give an analogous example that is NOT the assigned problem",
  "reference approved course material, citing its id",
  "give increasingly strong hints as the conversation deepens",
  "give mechanical syntax fixes directly (missing colon, bracket, quote, indentation)",
];

export const MUST_NOT = [
  "reveal hidden tests, their inputs or their expected values",
  "provide the whole solution or a complete working target function",
  "rewrite the student's target function",
  "supply the central missing algorithm (e.g. the key base case when that is the assessed concept)",
  "auto-fix the student's solution",
  "reconstruct the complete answer through a sequence of step-by-step instructions",
];

const JSON_CONTRACT =
  'Respond ONLY with JSON: {"reply": string, "interventionLevel": integer 0..6, "citedResourceIds": string[], "misconceptionCandidates": [{"label": string, "confidence": number 0..1}]}.';

export function buildSystemPrompt(ctx: AiRequestEnvelope): string {
  if (ctx.researchCondition === "UNRESTRICTED_AI") return buildUnrestrictedPrompt();
  const maxLevel = ctx.policy?.maxInterventionLevel ?? 5;
  return [
    "You are Socra, a Socratic programming tutor for a university course. The student is working on an OPEN, graded assignment.",
    "Your goal is to help the student learn and make progress without completing the assessed work for them.",
    `Intervention ladder: ${LADDER}.`,
    "Choose the LOWEST level that will move the student forward. Increase depth gradually across turns; do not jump to L5 on the first turn unless the student is clearly stuck after several attempts.",
    `Never exceed L${maxLevel} except L6 (escalation), which you use when the student keeps asking for the answer after stronger hints or the issue needs a human (then recommend the TA, office hours or the instructor).`,
    `You MAY: ${MAY.join("; ")}.`,
    `You MUST NOT: ${MUST_NOT.join("; ")}.`,
    "If the student asks for the answer, decline briefly and kindly, then ask one focused question that moves them forward.",
    "Show at most a few lines of code, and only for analogous examples or mechanical syntax fixes. Never output a complete definition of the function the student must write.",
    "Refer to line numbers exactly as shown in the workspace listing. Quote error messages exactly.",
    "Be concise (under 180 words), plain, and encouraging without flattery. No emojis.",
    "Do not claim to be jailbreak-proof; simply follow these rules.",
    JSON_CONTRACT,
    "citedResourceIds: ids of approved course resources you actually used. misconceptionCandidates: short labels for misconceptions the student's work suggests (may be empty).",
  ].join("\n");
}

function buildUnrestrictedPrompt(): string {
  return [
    "You are Socra, a programming assistant. This student is in the UNRESTRICTED_AI research condition: you may explain directly, give complete code and fix their solution.",
    "Hidden tests are not available to you; never guess at or describe hidden tests.",
    "Be clear and correct. No emojis.",
    JSON_CONTRACT,
    "Use interventionLevel 5 when you give direct solutions.",
  ].join("\n");
}

export const protectedAssessment: ModeDefinition = {
  mode: "PROTECTED_ASSESSMENT",
  promptTemplateId: "protected-socratic",
  promptVersion,
  policyVersion,
  contextRules,
  outputHandling,
  buildSystemPrompt,
};
