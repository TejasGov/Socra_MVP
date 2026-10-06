import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { runAi } from "@/server/ai/gateway";
import { getModeDefinition } from "@/server/ai/modes";
import { mockAnalyticsBrief } from "@/server/ai/providers/mock-modes";
import { mainFunctionName } from "@/server/ai/providers/mock-util";
import {
  assignmentDraftSuggestionSchema,
  writtenGradeSuggestionSchema,
  type AssignmentDraftModelOutput,
  type AssignmentDraftSuggestion,
  type SuggestedTest,
  type WrittenGradeSuggestion,
} from "@/server/ai/schemas";
import type { AiRequestEnvelope, AiMode, AiTask } from "@/server/ai/types";
import type { CurrentUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { runProtectedTurn } from "@/server/domain/socra/sessions";
import { getWorkspaceContextForAi } from "@/server/domain/workspace/context";
import { isEnabled } from "@/server/flags";
import { HttpError } from "@/server/http";

/**
 * Faculty AI services (TASK §22–24). Every output is a suggestion for human review: nothing publishes, grades or
 * changes student data automatically.
 */

export type { AssignmentDraftSuggestion, WrittenGradeSuggestion };

const AI_DOWN = "The AI assistant is unavailable right now. You can continue without it.";

function baseEnvelope(
  user: CurrentUser,
  mode: AiMode,
  task: AiTask,
  courseId: string,
  extra: Partial<AiRequestEnvelope> = {},
): AiRequestEnvelope {
  const def = getModeDefinition(mode);
  return {
    mode,
    task,
    traceId: randomUUID(),
    userId: user.id,
    courseId,
    assignmentId: null,
    questionId: null,
    sessionId: null,
    researchCondition: null,
    promptTemplateId: def.promptTemplateId,
    promptVersion: def.promptVersion,
    policyVersion: def.policyVersion,
    assignmentVersion: null,
    questionVersion: null,
    assignment: null,
    policy: null,
    workspace: null,
    latestExecution: null,
    retrievalScope: { courseId, allowedResourceIds: "NONE" },
    retrievedResources: [],
    conversation: [],
    userMessage: "",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Assignment copilot
// ---------------------------------------------------------------------------

export interface SuggestAssignmentInput {
  courseId: string;
  prompt: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  language?: "PYTHON" | "JAVASCRIPT" | "SCALA" | null;
  topicIds?: string[];
  assignmentId?: string | null;
}

export async function suggestAssignmentContent(
  user: CurrentUser,
  input: SuggestAssignmentInput,
): Promise<AssignmentDraftSuggestion & { suggestionId: string; aiRequestId: string }> {
  assertCan(user, "authoring:ai", { courseId: input.courseId });
  if (!(await isEnabled("facultyAiAuthoring", { courseId: input.courseId }))) {
    throw new HttpError(403, "feature_disabled", "AI authoring is turned off for this course.");
  }
  if (input.assignmentId) {
    // The assignment is only recorded on the AI request, but it must belong to the authorized course.
    const owned = await prisma.assignment.findFirst({
      where: { id: input.assignmentId, courseId: input.courseId },
      select: { id: true },
    });
    if (!owned) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  }
  const courseTopics = await prisma.topic.findMany({
    where: { courseId: input.courseId },
    select: { id: true, key: true, name: true },
  });
  const chosen = courseTopics.filter((t) => input.topicIds?.includes(t.id));
  const authoringInput = {
    prompt: input.prompt,
    format: input.format,
    language: input.language ?? null,
    topics: chosen.map((t) => t.name),
    courseTopicSlugs: courseTopics.map((t) => t.key),
  };
  const res = await runAi(
    baseEnvelope(user, "FACULTY_AUTHORING", "authoring_generation", input.courseId, {
      assignmentId: input.assignmentId ?? null,
      userMessage: input.prompt,
      authoringInput,
    }),
    { task: "authoring_generation", schema: assignmentDraftSuggestionSchema },
  );
  if (!res.ok || !res.structured) throw new HttpError(503, "ai_unavailable", AI_DOWN, { errorClass: res.ok ? "EMPTY" : res.errorClass });

  // Map suggested slugs onto the course's own topic keys. Slugs with no matching course topic are dropped:
  // topic tags must reference the course's curriculum graph, and the assignment service rejects unknown keys.
  const keys = new Set<string>();
  for (const t of chosen) keys.add(t.key);
  for (const slug of res.structured.topicSlugs) {
    const match = courseTopics.find((t) => t.key === slug || t.key.includes(slug) || slug.includes(t.key));
    if (match) keys.add(match.key);
  }
  const final = toApiSuggestion({ ...res.structured, topicSlugs: [...keys].slice(0, 10) });

  // Pending suggestion for faculty review. assignment_ai_generated is emitted by the assignment service when the
  // instructor actually creates an assignment from it (aiSuggestionId), so it is not emitted here.
  const row = await prisma.authoringSuggestion.create({
    data: {
      courseId: input.courseId,
      assignmentId: input.assignmentId ?? null,
      kind: "full_assignment",
      input: authoringInput as Prisma.InputJsonValue,
      content: final as unknown as Prisma.InputJsonValue,
      aiRequestId: res.aiRequestId || null,
      createdById: user.id,
    },
    select: { id: true },
  });
  return { ...final, suggestionId: row.id, aiRequestId: res.aiRequestId };
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toTest(
  t: { name: string; description?: string; argsJson: string; expectedJson: string },
  entryPoint: string | null,
): SuggestedTest {
  const parsedArgs = parseJsonValue(t.argsJson);
  const args = Array.isArray(parsedArgs) ? parsedArgs : [parsedArgs];
  const returns = parseJsonValue(t.expectedJson);
  return {
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    input: { kind: "function", ...(entryPoint ? { entryPoint } : {}), args },
    expected: { returns },
    ...(entryPoint ? { entryPoint } : {}),
    args,
    expectedReturn: returns,
  };
}

/** Model output (strict JSON-string test values) -> contract shape (C's TestCase convention, text hint ladder). */
export function toApiSuggestion(m: AssignmentDraftModelOutput): AssignmentDraftSuggestion {
  return {
    title: m.title,
    description: m.description,
    learningObjectives: m.learningObjectives,
    topicSlugs: m.topicSlugs,
    scaffold: m.scaffold,
    questions: m.questions.map((q, i) => {
      const entryPoint = mainFunctionName(q.starterCode);
      const points = q.rubric.reduce((sum, c) => sum + c.points, 0) || 10;
      return {
        title: m.questions.length > 1 ? `${m.title} (part ${i + 1})` : m.title,
        prompt: q.prompt,
        entryPoint,
        points,
        starterCode: q.starterCode,
        publicTests: q.publicTests.map((t) => toTest(t, entryPoint)),
        hiddenTestSuggestions: q.hiddenTestSuggestions.map((t) => toTest(t, entryPoint)),
        rubric: q.rubric.map((c) => ({ criterion: c.criterion, title: c.criterion, description: c.description, points: c.points, maxPoints: c.points })),
        hintLadder: [...q.hintLadder].sort((a, b) => a.level - b.level).map((h) => h.guidance),
        predictedMisconceptions: q.predictedMisconceptions,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Socra policy preview (faculty "test the policy"); never stored as student data
// ---------------------------------------------------------------------------

export async function testSocraPolicy(
  user: CurrentUser,
  input: { assignmentId: string; message: string; code?: string | null; questionId?: string | null },
): Promise<{ reply: string; interventionLevel: number | null; policyOutcome: string; aiRequestId: string }> {
  const a = await prisma.assignment.findUnique({ where: { id: input.assignmentId }, select: { courseId: true } });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, "assignment:preview", { courseId: a.courseId });
  const ctx = await getWorkspaceContextForAi(user.id, input.assignmentId, input.questionId ?? undefined);
  // Preview always exercises the PROTECTED policy; never include the reference solution.
  const assignment = { ...ctx.assignment, referenceSolution: undefined };
  const def = getModeDefinition("PROTECTED_ASSESSMENT");
  const envelope = baseEnvelope(user, "PROTECTED_ASSESSMENT", "socratic_turn", a.courseId, {
    assignmentId: input.assignmentId,
    questionId: assignment.questionId ?? null,
    assignmentVersion: assignment.assignmentVersion,
    questionVersion: assignment.questionVersion ?? null,
    policyVersion: `${def.policyVersion}+course-v${ctx.policy.policyVersion}:preview`,
    assignment,
    policy: ctx.policy,
    workspace: { ...ctx.workspace, code: input.code ?? assignment.starterCode ?? ctx.workspace.code },
    latestExecution: null,
    userMessage: input.message.slice(0, 4000),
  });
  const res = await runProtectedTurn(envelope, false);
  if ("error" in res) throw new HttpError(503, "ai_unavailable", AI_DOWN, { errorClass: res.error });
  return {
    reply: res.reply,
    interventionLevel: res.turn?.interventionLevel ?? null,
    policyOutcome: res.policyOutcome ?? (res.fallback ? "FALLBACK" : "ALLOW"),
    aiRequestId: res.aiRequestId,
  };
}

// ---------------------------------------------------------------------------
// Written-answer grading suggestion (faculty approves the final score)
// ---------------------------------------------------------------------------

export async function suggestWrittenGrade(
  user: CurrentUser,
  input: { submissionId: string; questionId: string },
): Promise<WrittenGradeSuggestion & { aiRequestId: string }> {
  const sub = await prisma.submission.findUnique({
    where: { id: input.submissionId },
    select: {
      courseId: true,
      assignmentId: true,
      answers: {
        where: { questionId: input.questionId },
        select: {
          content: true,
          questionVersion: { select: { prompt: true, points: true, answerKey: true, version: true } },
        },
      },
    },
  });
  if (!sub) throw new HttpError(404, "submission_not_found", "Submission not found");
  assertCan(user, "grade:write", { courseId: sub.courseId });
  if (!(await isEnabled("aiGradingSuggestions", { courseId: sub.courseId }))) {
    throw new HttpError(403, "feature_disabled", "AI grading suggestions are turned off for this course.");
  }
  const answer = sub.answers[0];
  if (!answer) throw new HttpError(404, "answer_not_found", "No answer for this question");
  const rubric = await prisma.rubric.findFirst({
    where: { OR: [{ questionId: input.questionId }, { assignmentId: sub.assignmentId, questionId: null }] },
    orderBy: [{ questionId: "asc" }, { version: "desc" }],
    select: { criteria: { orderBy: { order: "asc" }, select: { title: true, description: true, maxPoints: true } } },
  });
  const criteria = rubric?.criteria ?? [];
  const maxPoints = answer.questionVersion.points || criteria.reduce((s, c) => s + c.maxPoints, 0);
  const res = await runAi(
    baseEnvelope(user, "FACULTY_AUTHORING", "grading_suggestion", sub.courseId, {
      assignmentId: sub.assignmentId,
      questionId: input.questionId,
      questionVersion: answer.questionVersion.version,
      userMessage: "Suggest a rubric score for this written answer.",
      authoringInput: {
        questionPrompt: answer.questionVersion.prompt,
        answer: answer.content,
        maxPoints,
        rubric: criteria,
        answerKey: answer.questionVersion.answerKey ?? null,
      },
    }),
    { task: "grading_suggestion", schema: writtenGradeSuggestionSchema, maxOutputTokens: 900 },
  );
  if (!res.ok || !res.structured) throw new HttpError(503, "ai_unavailable", AI_DOWN, { errorClass: res.ok ? "EMPTY" : res.errorClass });
  const s = res.structured;
  return {
    ...s,
    maxPoints,
    suggestedPoints: Math.max(0, Math.min(s.suggestedPoints, maxPoints)),
    aiRequestId: res.aiRequestId,
  };
}

// ---------------------------------------------------------------------------
// Weekly teaching brief (model only sees computed metrics; numbers validated)
// ---------------------------------------------------------------------------

/** Every number in the input JSON (plus its percent forms), as normalized strings. */
export function allowedNumbers(metrics: unknown): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(normNum(n));
    out.add(normNum(Math.round(n * 100)));
    out.add(normNum(Math.round(n * 1000) / 10));
    out.add(normNum(Math.round(n * 100) / 100));
    out.add(normNum(Math.round(n * 10) / 10));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.match(/-?\d+(?:\.\d+)?/g) ?? []) add(Number(m));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(metrics);
  return out;
}

function normNum(n: number): string {
  return String(Number(n.toFixed(6)));
}

/** Numbers in the text that do not appear in the metrics (empty array = valid). */
export function inventedNumbers(text: string, metrics: unknown): string[] {
  const allowed = allowedNumbers(metrics);
  const found = text.replace(/,(?=\d{3})/g, "").match(/-?\d+(?:\.\d+)?/g) ?? [];
  return found.filter((f) => !allowed.has(normNum(Number(f))) && !allowed.has(normNum(Math.abs(Number(f)))));
}

function weekStartUtc(d = new Date()): Date {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export async function generateTeachingBrief(
  user: CurrentUser,
  input: { courseId: string; metrics: object },
): Promise<{ text: string; aiRequestId: string; source: "ai" | "template"; weekStart: string }> {
  assertCan(user, "analytics:ai_brief", { courseId: input.courseId });
  const metrics = JSON.parse(JSON.stringify(input.metrics)) as Record<string, unknown>;
  const envelope = baseEnvelope(user, "FACULTY_ANALYTICS", "analytics_brief", input.courseId, {
    userMessage: "Write this week's teaching brief from the computed metrics.",
    analyticsPayload: metrics,
  });
  const res = await runAi(envelope, { task: "analytics_brief" });
  let text: string;
  let source: "ai" | "template" = "ai";
  if (res.ok && res.text.trim() && inventedNumbers(res.text, metrics).length === 0) {
    text = res.text.trim();
  } else {
    source = "template";
    text = mockAnalyticsBrief({ ...envelope, analyticsPayload: metrics });
  }
  const aiRequestId = res.aiRequestId;
  const weekStart = weekStartUtc();
  await prisma.teachingBrief.upsert({
    where: { courseId_weekStart: { courseId: input.courseId, weekStart } },
    create: {
      courseId: input.courseId,
      weekStart,
      content: text,
      metricsSnapshot: metrics as Prisma.InputJsonValue,
      aiRequestId: aiRequestId || null,
      createdById: user.id,
    },
    update: { content: text, metricsSnapshot: metrics as Prisma.InputJsonValue, aiRequestId: aiRequestId || null, createdById: user.id },
  });
  return { text, aiRequestId, source, weekStart: weekStart.toISOString() };
}
