import type { AiRequestEnvelope } from "../types";
import type { ContextRules, ModeDefinition, OutputHandling } from "./shared";

/** FACULTY_AUTHORING — copilot suggestions for faculty review (TASK §23). Nothing publishes automatically. */
export const promptVersion = "faculty-authoring-v2";
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
  maxOutputTokens: 6000,
  logging: "faculty authoring; output is a pending suggestion",
};

function quizRequested(ctx: AiRequestEnvelope): boolean {
  const input = ctx.authoringInput as { format?: unknown } | null | undefined;
  return input?.format === "QUIZ";
}

const CODE_RULES = [
  "For a CODING or WRITTEN assignment, write one CODE question (or one WRITTEN question for a written assignment). For those questions choices is [], answer is \"\" (or the key points joined by \"||\" for WRITTEN), and explanation describes a correct approach.",
];

const QUIZ_RULES = [
  "This is a QUIZ: write 5 auto-gradable questions students answer in the browser, without running code:",
  "- at least 2 MULTIPLE_CHOICE questions with exactly 4 choices, ids \"a\", \"b\", \"c\", \"d\". Exactly one is correct; every distractor must be the answer a student with a specific, named misconception would choose (list those in predictedMisconceptions). answer is the correct choice id.",
  "- 1 TRACE question: a short program (put it in a fenced code block in the prompt) and ask what it prints or returns. answer lists every acceptable spelling of the exact output joined by \"||\" (for example \"1 2 3||1,2,3\").",
  "- 1 SHORT_ANSWER question with a single short exact answer (a number, value or keyword); answer lists accepted spellings joined by \"||\".",
  "- optionally 1 WRITTEN explanation question; answer lists the key points joined by \"||\" and rubric holds the scoring criteria (it is graded by a person).",
  "Trace every program yourself and double-check each answer: a wrong key grades students wrong. explanation says why the answer is right and why the common wrong answers are wrong; students see it only after solutions are released.",
  "For non-CODE questions starterCode is \"\", publicTests and hiddenTestSuggestions are [], and rubric is [] except for WRITTEN. points: 2 for auto-graded questions, 4 for WRITTEN. Give each question a short title. scaffold may be [].",
];

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
    "Every question has a type: CODE, MULTIPLE_CHOICE, SHORT_ANSWER, TRACE (\"what does this code print/return\") or WRITTEN.",
    ...(quizRequested(ctx) ? QUIZ_RULES : CODE_RULES),
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
