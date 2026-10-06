import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { runAi } from "@/server/ai/gateway";
import type { AiRequestEnvelope, AiTask } from "@/server/ai/types";
import { retrieveCourseResources } from "@/server/domain/resources/retrieve";
import { parseChoices, type PracticeChoice } from "./logic";

export const PRACTICE_GEN_PROMPT_VERSION = "practice-gen-v1";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface PracticeEnvelopeInput {
  userId: string;
  courseId: string;
  task: AiTask;
  promptTemplateId: string;
  promptVersion: string;
  userMessage: string;
  retrievalQuery?: string;
  topicStates?: Array<{ topic: string; state: string }>;
  authoringInput?: Record<string, unknown> | null;
}

export async function buildPracticeEnvelope(input: PracticeEnvelopeInput): Promise<AiRequestEnvelope> {
  const retrieved = input.retrievalQuery
    ? await retrieveCourseResources({
        courseId: input.courseId,
        query: input.retrievalQuery,
        limit: 3,
      }).catch(() => [])
    : [];
  return {
    mode: "PRACTICE",
    task: input.task,
    traceId: randomUUID(),
    userId: input.userId,
    courseId: input.courseId,
    assignmentId: null,
    questionId: null,
    sessionId: null,
    researchCondition: null,
    promptTemplateId: input.promptTemplateId,
    promptVersion: input.promptVersion,
    policyVersion: "practice-v1",
    assignmentVersion: null,
    questionVersion: null,
    assignment: null,
    policy: null,
    workspace: null,
    latestExecution: null,
    retrievalScope: { courseId: input.courseId, allowedResourceIds: "ALL_COURSE" },
    retrievedResources: retrieved,
    conversation: [],
    userMessage: input.userMessage,
    learnerContext: input.topicStates ? { topicStates: input.topicStates } : null,
    authoringInput: input.authoringInput ?? null,
  };
}

// ---------------------------------------------------------------------------
// Live generation
// ---------------------------------------------------------------------------

export const generatedItemSchema = z.object({
  type: z.enum(["MULTIPLE_CHOICE", "SHORT_ANSWER", "TRACE", "EXPLAIN"]),
  prompt: z.string().min(10),
  starterCode: z.string().nullable(),
  choices: z
    .array(z.object({ id: z.string(), text: z.string(), correct: z.boolean() }))
    .nullable(),
  answer: z.string().min(1),
  explanation: z.string().min(1),
});
export type GeneratedItem = z.infer<typeof generatedItemSchema>;

/** Extra validation beyond the schema: multiple choice needs 3+ choices and exactly one correct. */
export function validateGeneratedItem(item: GeneratedItem): GeneratedItem | null {
  if (item.type === "MULTIPLE_CHOICE") {
    const choices = item.choices ?? [];
    if (choices.length < 3 || choices.filter((c) => c.correct).length !== 1) return null;
  }
  return item;
}

export function contentHash(courseId: string, topicId: string, prompt: string): string {
  const norm = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${courseId}:${topicId}:${norm}`).digest("hex");
}

export interface GenerateInput {
  userId: string;
  courseId: string;
  topicName: string;
  topicDescription: string | null;
  difficulty: number;
  scaffold: boolean;
  avoidPrompts: string[];
  topicStates?: Array<{ topic: string; state: string }>;
}

export type GenerateOutcome =
  | { ok: true; item: GeneratedItem; model: string; aiRequestId: string }
  | { ok: false; message: string };

export async function generatePracticeItem(input: GenerateInput): Promise<GenerateOutcome> {
  const userMessage = [
    `Write ONE practice question for the course topic "${input.topicName}".`,
    input.topicDescription ? `Topic description: ${input.topicDescription}` : "",
    `Difficulty: ${input.difficulty} on a 1 (easiest) to 5 (hardest) scale.`,
    input.scaffold
      ? "The student missed the last two questions, so make this one scaffolded: break the task into a smaller first step and keep the wording simple."
      : "",
    "Prefer MULTIPLE_CHOICE, SHORT_ANSWER or TRACE (predict the output of a short program, put the program in the prompt). Use EXPLAIN only for conceptual questions.",
    "For MULTIPLE_CHOICE give 4 choices with ids A-D and exactly one correct. For SHORT_ANSWER the answer must be a short string; separate alternative accepted answers with ||. For TRACE the answer is the exact expected output.",
    "Include a full explanation of why the answer is right. Use only material that fits this course.",
    input.avoidPrompts.length
      ? `Do not repeat these earlier questions:\n- ${input.avoidPrompts.slice(0, 5).join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const envelope = await buildPracticeEnvelope({
      userId: input.userId,
      courseId: input.courseId,
      task: "practice_generation",
      promptTemplateId: "practice_generation",
      promptVersion: PRACTICE_GEN_PROMPT_VERSION,
      userMessage,
      retrievalQuery: input.topicName,
      topicStates: input.topicStates,
      authoringInput: {
        topic: input.topicName,
        difficulty: input.difficulty,
        scaffold: input.scaffold,
      },
    });
    const res = await runAi(envelope, {
      task: "practice_generation",
      schema: generatedItemSchema,
      maxOutputTokens: 900,
    });
    if (!res.ok) return { ok: false, message: res.message };
    const parsed = generatedItemSchema.safeParse(res.structured);
    if (!parsed.success) return { ok: false, message: "Generated item did not match the schema" };
    const valid = validateGeneratedItem(parsed.data);
    if (!valid) return { ok: false, message: "Generated item failed validation" };
    return { ok: true, item: valid, model: res.model, aiRequestId: res.aiRequestId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "generation failed" };
  }
}

export function choicesForStorage(item: GeneratedItem): PracticeChoice[] | null {
  if (item.type !== "MULTIPLE_CHOICE") return null;
  return parseChoices(item.choices);
}

// ---------------------------------------------------------------------------
// Free-response grading and explanations
// ---------------------------------------------------------------------------

const gradeSchema = z.object({
  correct: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string(),
});

export async function gradeFreeResponse(input: {
  userId: string;
  courseId: string;
  prompt: string;
  modelAnswer: string | null;
  rubric: unknown;
  answer: string;
}): Promise<{ correct: boolean; score: number; feedback: string } | null> {
  try {
    const envelope = await buildPracticeEnvelope({
      userId: input.userId,
      courseId: input.courseId,
      task: "practice_grading",
      promptTemplateId: "practice_grading",
      promptVersion: "practice-grade-v1",
      userMessage: [
        "Grade the student's answer to this practice question. Be strict about correctness and kind in feedback.",
        `Question:\n${input.prompt}`,
        input.modelAnswer ? `Model answer:\n${input.modelAnswer}` : "",
        input.rubric ? `Rubric:\n${JSON.stringify(input.rubric)}` : "",
        `Student answer:\n${input.answer}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const res = await runAi(envelope, {
      task: "practice_grading",
      schema: gradeSchema,
      maxOutputTokens: 400,
    });
    if (!res.ok) return null;
    const parsed = gradeSchema.safeParse(res.structured);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function explainWithAi(input: {
  userId: string;
  courseId: string;
  prompt: string;
  modelAnswer: string | null;
  storedExplanation: string | null;
  studentAnswer: string | null;
  topicName: string;
}): Promise<{ text: string; aiRequestId: string } | null> {
  try {
    const envelope = await buildPracticeEnvelope({
      userId: input.userId,
      courseId: input.courseId,
      task: "practice_tutor_turn",
      promptTemplateId: "practice_tutor_turn",
      promptVersion: "practice-explain-v1",
      retrievalQuery: `${input.topicName} ${input.prompt}`.slice(0, 300),
      userMessage: [
        "The student is in practice mode and asked for an explanation. You may give the complete answer and a worked explanation.",
        `Question:\n${input.prompt}`,
        input.modelAnswer ? `Reference answer:\n${input.modelAnswer}` : "",
        input.storedExplanation ? `Reference explanation:\n${input.storedExplanation}` : "",
        input.studentAnswer
          ? `Student's answer:\n${input.studentAnswer}\nSay what is right and what is not in their answer.`
          : "The student has not answered yet.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const res = await runAi(envelope, { task: "practice_tutor_turn", maxOutputTokens: 700 });
    if (!res.ok || !res.text.trim()) return null;
    return { text: res.text.trim(), aiRequestId: res.aiRequestId };
  } catch {
    return null;
  }
}
