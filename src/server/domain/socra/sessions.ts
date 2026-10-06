import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { AiMode as DbAiMode, StudyCondition } from "@/generated/prisma/enums";
import { isKillSwitchOn, runAi, streamAi, updateAiRequestStatus } from "@/server/ai/gateway";
import { getModeDefinition } from "@/server/ai/modes";
import { unrestrictedPolicyVersion } from "@/server/ai/modes/protected-assessment";
import {
  checkProtectedOutput,
  loadPolicyMaterial,
  persistPolicyDecision,
  type PolicyCheckOutcome,
  type PolicyCheckResult,
} from "@/server/ai/policy-check";
import { protectedTurnSchema, type ProtectedTurn } from "@/server/ai/schemas";
import type {
  AiRequestEnvelope,
  AssignmentContext,
  ConversationTurn,
  InterventionLevel,
  LatestExecutionContext,
  PolicyContext,
  RetrievedResource,
  StudentAiMode,
  WorkspaceContext,
} from "@/server/ai/types";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { getEffectiveAiMode, getWorkspaceContextForAi } from "@/server/domain/workspace/context";
import { recordMisconceptionObservation } from "@/server/domain/misconceptions";
import { retrieveCourseResources } from "@/server/domain/resources/retrieve";
import { writeEvent } from "@/server/events";
import { isEnabled } from "@/server/flags";
import { HttpError } from "@/server/http";
import { checkBudget, SOCRA_LIMIT_MESSAGE } from "./budget";

/**
 * Socra conversation service (student modes). Owns AiSession / AiMessage / RetrievalCitation / SocraEscalation
 * writes and the socra_* events. All model calls go through src/server/ai/gateway.ts.
 *
 * Protected mode: context comes from C's getWorkspaceContextForAi (PUBLIC test output only; no hidden tests, no
 * reference solution). The structured reply is validated, policy-checked, and only then streamed to the client.
 */

export const SOCRA_UNAVAILABLE_MESSAGE = "Socra is not available for this activity.";
export const MISCONCEPTION_CONFIDENCE_THRESHOLD = 0.6;

export type SocraSseEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      messageId: string | null;
      interventionLevel: number | null;
      citations: Array<{ resourceId: string; title: string; section: string | null }>;
      limitReached: boolean;
      policyOutcome: string | null;
    }
  | { type: "error"; code: string; message: string };

export class SocraUnavailableError extends HttpError {
  constructor(reason: string) {
    super(403, "socra_unavailable", SOCRA_UNAVAILABLE_MESSAGE, { reason });
  }
}

// ---------------------------------------------------------------------------
// Availability / effective mode
// ---------------------------------------------------------------------------

export interface SocraAvailability {
  available: boolean;
  reason: string | null;
  mode: StudentAiMode | null;
  courseId: string | null;
  researchCondition: StudyCondition | null;
  /** UNRESTRICTED_AI condition: direct-help policy (logged). */
  directHelp: boolean;
}

async function researchConditionFor(userId: string, courseId: string): Promise<StudyCondition | null> {
  const p = await prisma.studyParticipant.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { condition: true, withdrawnAt: true },
  });
  return p && !p.withdrawnAt ? p.condition : null;
}

/** Whether Socra can be used on an assignment by this student, and in which mode. Never throws for "unavailable". */
export async function getSocraAvailability(
  user: CurrentUser,
  target: { assignmentId?: string | null; practiceSessionId?: string | null },
): Promise<SocraAvailability> {
  const no = (reason: string, extra: Partial<SocraAvailability> = {}): SocraAvailability => ({
    available: false,
    reason,
    mode: null,
    courseId: null,
    researchCondition: null,
    directHelp: false,
    ...extra,
  });
  // Runtime kill switch (env AI_KILL_SWITCH or admin flag) -> "Socra is not available" state, never an exception.
  if (await isKillSwitchOn()) return no("ai_kill_switch");
  if (target.practiceSessionId) {
    const ps = await prisma.practiceSession.findUnique({
      where: { id: target.practiceSessionId },
      select: { userId: true, courseId: true },
    });
    if (!ps || ps.userId !== user.id) return no("practice_session_not_found");
    assertCan(user, "socra:use", { courseId: ps.courseId });
    const condition = await researchConditionFor(user.id, ps.courseId);
    if (condition === "CONTROL") return no("research_condition_control", { courseId: ps.courseId, researchCondition: condition });
    return { available: true, reason: null, mode: "PRACTICE", courseId: ps.courseId, researchCondition: condition, directHelp: true };
  }
  if (!target.assignmentId) return no("no_activity");
  const a = await prisma.assignment.findUnique({
    where: { id: target.assignmentId },
    select: { courseId: true, state: true },
  });
  if (!a) return no("assignment_not_found");
  assertCan(user, "socra:use", { courseId: a.courseId });
  if (a.state === "DRAFT" || a.state === "SCHEDULED") return no("assignment_not_open", { courseId: a.courseId });
  const condition = await researchConditionFor(user.id, a.courseId);
  if (condition === "CONTROL") return no("research_condition_control", { courseId: a.courseId, researchCondition: condition });
  let mode: StudentAiMode = await getEffectiveAiMode(user.id, target.assignmentId);
  if (mode === "POST_ASSESSMENT_REVIEW" && !(await isEnabled("postAssessmentSolutions", { courseId: a.courseId }))) {
    mode = "PROTECTED_ASSESSMENT";
  }
  if (mode === "PROTECTED_ASSESSMENT" && !(await isEnabled("protectedSocra", { courseId: a.courseId }))) {
    return no("flag_protected_socra_off", { courseId: a.courseId, researchCondition: condition });
  }
  return {
    available: true,
    reason: null,
    mode,
    courseId: a.courseId,
    researchCondition: condition,
    directHelp: condition === "UNRESTRICTED_AI",
  };
}

export function policySummaryFor(mode: StudentAiMode, directHelp: boolean): string {
  if (mode === "PRACTICE") return "Practice mode: Socra can explain answers and worked examples directly.";
  if (mode === "POST_ASSESSMENT_REVIEW") {
    return "This assignment is closed and solutions are released. Socra can explain the full solution and compare it with your work.";
  }
  if (directHelp) return "Socra can see your code, latest run and the assignment, and can help directly on this activity.";
  return "Socra sees your code, your latest run, public test results and the assignment. It guides you with questions and hints but will not write the solution or reveal hidden tests.";
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  assignmentId?: string | null;
  questionId?: string | null;
  practiceSessionId?: string | null;
  mode?: string | null;
}

export async function createSocraSession(
  user: CurrentUser,
  input: CreateSessionInput,
): Promise<{ sessionId: string; mode: StudentAiMode; policySummary: string; created: boolean }> {
  const availability = await getSocraAvailability(user, input);
  if (!availability.available || !availability.mode || !availability.courseId) {
    throw new SocraUnavailableError(availability.reason ?? "unavailable");
  }
  const mode = availability.mode;
  const courseId = availability.courseId;

  let assignmentVersion: number | null = null;
  let policyVersion: number | null = null;
  let questionId: string | null = input.questionId ?? null;
  if (input.assignmentId && !input.practiceSessionId) {
    const a = await prisma.assignment.findUnique({
      where: { id: input.assignmentId },
      select: {
        currentVersion: { select: { version: true, policyVersionId: true } },
        socraPolicy: { select: { currentVersion: { select: { version: true } } } },
        questions: { orderBy: { order: "asc" }, select: { id: true } },
      },
    });
    assignmentVersion = a?.currentVersion?.version ?? null;
    policyVersion = a?.socraPolicy?.currentVersion?.version ?? null;
    if (a?.currentVersion?.policyVersionId) {
      const pv = await prisma.socraPolicyVersion.findUnique({
        where: { id: a.currentVersion.policyVersionId },
        select: { version: true },
      });
      policyVersion = pv?.version ?? policyVersion;
    }
    if (questionId && !a?.questions.some((q) => q.id === questionId)) {
      throw new HttpError(404, "question_not_found", "Question not found");
    }
    questionId = questionId ?? a?.questions[0]?.id ?? null;
  }

  const existing = await prisma.aiSession.findFirst({
    where: input.practiceSessionId
      ? { practiceSessionId: input.practiceSessionId, userId: user.id }
      : { userId: user.id, assignmentId: input.assignmentId ?? null, questionId, mode, status: { in: ["ACTIVE", "LIMIT_REACHED", "ESCALATED"] } },
    orderBy: { startedAt: "desc" },
    select: { id: true, mode: true },
  });
  if (existing) {
    if (existing.mode !== mode) {
      await prisma.aiSession.update({ where: { id: existing.id }, data: { mode } });
    }
    return { sessionId: existing.id, mode, policySummary: policySummaryFor(mode, availability.directHelp), created: false };
  }

  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.aiSession.create({
      data: {
        userId: user.id,
        courseId,
        mode,
        assignmentId: input.practiceSessionId ? null : (input.assignmentId ?? null),
        questionId: input.practiceSessionId ? null : questionId,
        practiceSessionId: input.practiceSessionId ?? null,
        assignmentVersion,
        policyVersion,
        researchCondition: availability.researchCondition,
      },
      select: { id: true },
    });
    await writeEvent(tx, {
      eventName: "socra_session_started",
      actorId: user.id,
      courseId,
      assignmentId: input.practiceSessionId ? null : (input.assignmentId ?? null),
      assignmentVersion,
      questionId: input.practiceSessionId ? null : questionId,
      sessionId: s.id,
      researchCondition: availability.researchCondition,
      idempotencyKey: `socra_session_started:${s.id}`,
      metadata: { mode, ...(policyVersion !== null ? { policyVersion } : {}) },
    });
    return s;
  });
  return { sessionId: session.id, mode, policySummary: policySummaryFor(mode, availability.directHelp), created: true };
}

/** Student's own session with USER/ASSISTANT messages. 404 for anyone else (no enumeration). */
export async function getOwnSocraSession(user: CurrentUser, sessionId: string) {
  const s = await prisma.aiSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      mode: true,
      status: true,
      assignmentId: true,
      questionId: true,
      practiceSessionId: true,
      maxInterventionLevel: true,
      turnCount: true,
      startedAt: true,
      lastActivityAt: true,
      messages: {
        where: { role: { in: ["USER", "ASSISTANT"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, interventionLevel: true, metadata: true, createdAt: true },
      },
    },
  });
  if (!s || s.userId !== user.id) throw new HttpError(404, "session_not_found", "Session not found");
  assertCan(user, "socra:history:read_own", { ownerId: s.userId, courseId: s.courseId });
  const messages = s.messages.map((m) => {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      interventionLevel: m.interventionLevel,
      citations: Array.isArray(meta.citations) ? meta.citations : [],
      policyOutcome: typeof meta.policyOutcome === "string" ? meta.policyOutcome : null,
      createdAt: m.createdAt.toISOString(),
    };
  });
  const { messages: _m, userId: _u, ...session } = s;
  return { session: { ...session, messages }, status: s.status, messages };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface SendMessageInput {
  content: string;
  workspace?: { code: string; language?: string | null } | null;
}

const LANGS = new Set(["PYTHON", "JAVASCRIPT", "SCALA"]);

interface TurnContext {
  courseId: string;
  assignment: AssignmentContext | null;
  workspace: WorkspaceContext | null;
  latestExecution: LatestExecutionContext | null;
  policy: PolicyContext | null;
  assignmentVersion: number | null;
  questionVersion: number | null;
  allowedResourceIds: string[] | "ALL_COURSE" | "NONE";
  topicTags: string[];
  learnerContext: AiRequestEnvelope["learnerContext"];
  policyMaxTurns: { perSession: number | null; perDay: number | null };
}

async function loadTurnContext(
  user: CurrentUser,
  session: { courseId: string; assignmentId: string | null; questionId: string | null; practiceSessionId: string | null },
  input: SendMessageInput,
): Promise<TurnContext> {
  const liveWorkspace = (base: WorkspaceContext | null): WorkspaceContext | null => {
    if (!input.workspace) return base;
    const lang = (input.workspace.language ?? "").toUpperCase();
    return {
      language: LANGS.has(lang) ? (lang as WorkspaceContext["language"]) : (base?.language ?? null),
      code: input.workspace.code.slice(0, 60_000),
      draftVersion: base?.draftVersion,
      questionTitle: base?.questionTitle,
    };
  };

  if (session.assignmentId) {
    const ctx = await getWorkspaceContextForAi(user.id, session.assignmentId, session.questionId ?? undefined);
    const a = await prisma.assignment.findUnique({
      where: { id: session.assignmentId },
      select: {
        resourceScope: true,
        resources: { select: { resourceId: true } },
        currentVersion: { select: { policyVersionId: true } },
        socraPolicy: { select: { currentVersionId: true } },
      },
    });
    const pvId = a?.currentVersion?.policyVersionId ?? a?.socraPolicy?.currentVersionId ?? null;
    const pv = pvId
      ? await prisma.socraPolicyVersion.findUnique({
          where: { id: pvId },
          select: { maxTurnsPerSession: true, maxTurnsPerDay: true, allowResourceRetrieval: true },
        })
      : null;
    const allowRetrieval = pv?.allowResourceRetrieval ?? true;
    const allowedResourceIds: TurnContext["allowedResourceIds"] =
      !allowRetrieval || a?.resourceScope === "NONE"
        ? "NONE"
        : a?.resourceScope === "SELECTED_RESOURCES"
          ? (a.resources.map((r) => r.resourceId) ?? [])
          : "ALL_COURSE";
    return {
      courseId: session.courseId,
      assignment: ctx.assignment,
      workspace: liveWorkspace(ctx.workspace),
      latestExecution: ctx.latestExecution,
      policy: ctx.policy,
      assignmentVersion: ctx.assignment.assignmentVersion,
      questionVersion: ctx.assignment.questionVersion ?? null,
      allowedResourceIds,
      topicTags: ctx.assignment.topicTags,
      learnerContext: null,
      policyMaxTurns: { perSession: pv?.maxTurnsPerSession ?? null, perDay: pv?.maxTurnsPerDay ?? null },
    };
  }

  // Practice session: current item (practice may reveal answers) + learner topic states.
  let assignment: AssignmentContext | null = null;
  const topicTags: string[] = [];
  let learnerContext: AiRequestEnvelope["learnerContext"] = null;
  if (session.practiceSessionId) {
    const ps = await prisma.practiceSession.findUnique({
      where: { id: session.practiceSessionId },
      select: {
        topic: { select: { name: true } },
        attempts: {
          orderBy: { shownAt: "desc" },
          take: 1,
          select: { answer: true, item: { select: { id: true, prompt: true, answer: true, explanation: true, starterCode: true, topic: { select: { name: true } } } } },
        },
      },
    });
    const item = ps?.attempts[0]?.item;
    if (ps?.topic?.name) topicTags.push(ps.topic.name);
    if (item?.topic.name && !topicTags.includes(item.topic.name)) topicTags.push(item.topic.name);
    if (item) {
      assignment = {
        assignmentId: `practice:${item.id}`,
        assignmentVersion: 1,
        title: `Practice: ${item.topic.name}`,
        prompt: [
          item.prompt,
          item.answer ? `Reference answer (practice may reveal it): ${item.answer}` : "",
          item.explanation ? `Reference explanation: ${item.explanation}` : "",
          ps?.attempts[0]?.answer ? `Student's latest answer: ${ps.attempts[0].answer}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        learningObjectives: [],
        topicTags,
        format: "QUIZ",
        starterCode: item.starterCode ?? undefined,
      };
    }
    const states = await prisma.learnerTopicState.findMany({
      where: { userId: user.id, courseId: session.courseId },
      select: { state: true, topic: { select: { name: true } } },
      take: 20,
    });
    learnerContext = { topicStates: states.map((s) => ({ topic: s.topic.name, state: s.state })) };
  }
  return {
    courseId: session.courseId,
    assignment,
    workspace: liveWorkspace(null),
    latestExecution: null,
    policy: null,
    assignmentVersion: null,
    questionVersion: null,
    allowedResourceIds: "ALL_COURSE",
    topicTags,
    learnerContext,
    policyMaxTurns: { perSession: null, perDay: null },
  };
}

async function retrieveFor(
  courseId: string,
  query: string,
  allowed: TurnContext["allowedResourceIds"],
): Promise<Array<RetrievedResource & { section: string | null }>> {
  if (allowed === "NONE") return [];
  if (Array.isArray(allowed) && allowed.length === 0) return [];
  try {
    if (!(await isEnabled("courseRag", { courseId }))) return [];
    const rows = await retrieveCourseResources({
      courseId,
      query: query.slice(0, 500),
      allowedResourceIds: Array.isArray(allowed) ? allowed : null,
      limit: 3,
    });
    return rows.map((r) => ({ ...r, section: r.section ?? null }));
  } catch (err) {
    console.error("[socra] retrieval failed (continuing without resources)", err);
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function* chunkText(text: string, size = 28): Generator<string> {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [];
  let buf = "";
  for (const p of pieces) {
    buf += p;
    if (buf.length >= size) {
      yield buf;
      buf = "";
    }
  }
  if (buf) yield buf;
}

const clampLevel = (level: number, max: number): InterventionLevel =>
  (level === 6 ? 6 : Math.max(0, Math.min(level, max))) as InterventionLevel;

/** Safe deterministic reply when the model output is unusable (never stored as authoritative inference). */
function safeFallbackReply(reason: "invalid_output" | "policy"): string {
  return reason === "policy"
    ? "I can't show that much of the solution during an open assignment. Let's take a smaller step: which line of your code do you think behaves differently from what you intended, and what value does it produce for the smallest test input?"
    : "Let's take this one step at a time. What should your code produce for the smallest input in the prompt, and what does it produce when you run it?";
}

interface ProtectedOutcome {
  reply: string;
  turn: ProtectedTurn | null;
  aiRequestId: string;
  policyOutcome: PolicyCheckOutcome | null;
  decisionIds: string[];
  fallback: boolean;
}

export async function runProtectedTurn(envelope: AiRequestEnvelope, directHelp: boolean): Promise<ProtectedOutcome | { error: string; aiRequestId: string }> {
  const first = await runAi(envelope, { task: "socratic_turn", schema: protectedTurnSchema });
  if (!first.ok) {
    if (first.errorClass === "INVALID_OUTPUT") {
      await updateAiRequestStatus(first.aiRequestId, "FALLBACK", { fallbackUsed: true });
      return { reply: safeFallbackReply("invalid_output"), turn: null, aiRequestId: first.aiRequestId, policyOutcome: null, decisionIds: [], fallback: true };
    }
    return { error: first.errorClass, aiRequestId: first.aiRequestId };
  }
  const material = await loadPolicyMaterial(envelope.questionId);
  const ctx = {
    hiddenTests: material.hiddenTests,
    // Direct-help condition: only the hidden-test check applies (solutions may be shown, hidden tests never).
    referenceSolution: directHelp ? null : material.referenceSolution,
    entryPoint: directHelp ? null : material.entryPoint,
    studentCode: envelope.workspace?.code ?? "",
    publicCorpus: [
      envelope.assignment?.prompt ?? "",
      envelope.assignment?.starterCode ?? "",
      ...(envelope.latestExecution?.publicTests ?? []).map((t) => `${t.name} ${t.message ?? ""}`),
      envelope.latestExecution?.stdout ?? "",
      envelope.latestExecution?.stderr ?? "",
    ].join("\n"),
  };
  const decisionIds: string[] = [];
  const record = async (aiRequestId: string, res: PolicyCheckResult, level: number | null, outcome = res.outcome) => {
    const id = await persistPolicyDecision({
      sessionId: envelope.sessionId,
      aiRequestId,
      mode: envelope.mode,
      policyVersion: envelope.policyVersion ?? "unknown",
      checker: directHelp ? "rules-v1:unrestricted" : undefined,
      outcome,
      checks: res.checks,
      reasons: res.reasons,
      interventionLevel: level,
    });
    if (id) decisionIds.push(id);
  };

  const turn1 = first.structured!;
  const check1 = checkProtectedOutput(turn1.reply, ctx);
  if (check1.outcome === "ALLOW" || check1.outcome === "REDACT") {
    await record(first.aiRequestId, check1, turn1.interventionLevel);
    return {
      reply: check1.outcome === "REDACT" ? (check1.redactedReply ?? turn1.reply) : turn1.reply,
      turn: turn1,
      aiRequestId: first.aiRequestId,
      policyOutcome: check1.outcome,
      decisionIds,
      fallback: false,
    };
  }
  await record(first.aiRequestId, check1, turn1.interventionLevel);
  await updateAiRequestStatus(first.aiRequestId, "BLOCKED_BY_POLICY");

  // Regenerate once with the violation explained.
  const second = await runAi(envelope, {
    task: "socratic_turn",
    schema: protectedTurnSchema,
    extraInstruction: `Your previous draft was blocked by the assessment policy (${check1.reasons.join("; ")}). Rewrite it: no hidden-test values, no complete definition of the target function, no code that reproduces the solution. Ask a guiding question or give a hint instead.`,
  });
  if (second.ok && second.structured) {
    const check2 = checkProtectedOutput(second.structured.reply, ctx);
    if (check2.outcome === "ALLOW" || check2.outcome === "REDACT") {
      await record(second.aiRequestId, check2, second.structured.interventionLevel);
      return {
        reply: check2.outcome === "REDACT" ? (check2.redactedReply ?? second.structured.reply) : second.structured.reply,
        turn: second.structured,
        aiRequestId: second.aiRequestId,
        policyOutcome: "BLOCK_AND_REGENERATE",
        decisionIds,
        fallback: false,
      };
    }
    await record(second.aiRequestId, check2, second.structured.interventionLevel, "ESCALATE");
    await updateAiRequestStatus(second.aiRequestId, "BLOCKED_BY_POLICY", { fallbackUsed: true });
  }
  const finalId = second.aiRequestId || first.aiRequestId;
  return {
    reply: safeFallbackReply("policy"),
    turn: null,
    aiRequestId: finalId,
    policyOutcome: "ESCALATE",
    decisionIds,
    fallback: true,
  };
}

/**
 * Send one student turn. Yields SSE events: deltas, then done (or error). Never throws after the user message is
 * accepted; AI failure leaves the student's work untouched.
 */
export async function* sendSocraMessage(
  user: CurrentUser,
  sessionId: string,
  input: SendMessageInput,
  signal?: AbortSignal,
): AsyncGenerator<SocraSseEvent> {
  const content = input.content.trim().slice(0, 4000);
  if (!content) {
    yield { type: "error", code: "empty_message", message: "Type a question for Socra." };
    return;
  }
  const session = await prisma.aiSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      mode: true,
      status: true,
      assignmentId: true,
      questionId: true,
      practiceSessionId: true,
      turnCount: true,
      maxInterventionLevel: true,
      researchCondition: true,
    },
  });
  if (!session || session.userId !== user.id) throw new HttpError(404, "session_not_found", "Session not found");

  const availability = await getSocraAvailability(user, {
    assignmentId: session.assignmentId,
    practiceSessionId: session.practiceSessionId,
  });
  if (!availability.available || !availability.mode) {
    yield { type: "error", code: "socra_unavailable", message: SOCRA_UNAVAILABLE_MESSAGE };
    return;
  }
  const mode = availability.mode;
  const def = getModeDefinition(mode);
  const researchCondition = availability.researchCondition;

  const limitDone = (messageId: string | null): SocraSseEvent => ({
    type: "done",
    messageId,
    interventionLevel: null,
    citations: [],
    limitReached: true,
    policyOutcome: null,
  });

  if (session.status === "LIMIT_REACHED") {
    yield { type: "delta", text: SOCRA_LIMIT_MESSAGE };
    yield limitDone(null);
    return;
  }

  let ctx: TurnContext;
  try {
    ctx = await loadTurnContext(user, session, input);
  } catch (err) {
    if (err instanceof HttpError) {
      yield { type: "error", code: err.code, message: err.message };
      return;
    }
    throw err;
  }

  const budget = await checkBudget({
    userId: user.id,
    courseId: session.courseId,
    sessionTurnCount: session.turnCount,
    maxTurnsPerSession: ctx.policyMaxTurns.perSession,
    maxTurnsPerDay: ctx.policyMaxTurns.perDay,
  });
  if (!budget.ok) {
    await prisma.$transaction(async (tx) => {
      if (budget.limit === "session_turns") {
        await tx.aiSession.update({ where: { id: session.id }, data: { status: "LIMIT_REACHED" } });
      }
      await writeEvent(tx, {
        eventName: "socra_limit_reached",
        actorId: user.id,
        courseId: session.courseId,
        assignmentId: session.assignmentId,
        assignmentVersion: ctx.assignmentVersion,
        questionId: session.questionId,
        sessionId: session.id,
        researchCondition,
        idempotencyKey: `socra_limit_reached:${session.id}:${budget.limit}:${session.turnCount}`,
        metadata: { limit: budget.limit },
      });
    });
    yield { type: "delta", text: budget.message };
    if (budget.limit === "rate_limit") {
      yield { type: "done", messageId: null, interventionLevel: null, citations: [], limitReached: false, policyOutcome: null };
    } else {
      yield limitDone(null);
    }
    return;
  }

  // Persist the student's message + socra_prompt_sent.
  const turnNumber = session.turnCount + 1;
  const userMessage = await prisma.$transaction(async (tx) => {
    const m = await tx.aiMessage.create({
      data: { sessionId: session.id, role: "USER", content },
      select: { id: true },
    });
    await tx.aiSession.update({
      where: { id: session.id },
      data: { turnCount: { increment: 1 }, lastActivityAt: new Date(), mode: mode as DbAiMode },
    });
    await writeEvent(tx, {
      eventName: "socra_prompt_sent",
      actorId: user.id,
      courseId: session.courseId,
      assignmentId: session.assignmentId,
      assignmentVersion: ctx.assignmentVersion,
      questionId: session.questionId,
      questionVersion: ctx.questionVersion,
      sessionId: session.id,
      researchCondition,
      idempotencyKey: `socra_prompt_sent:${m.id}`,
      metadata: { mode, messageId: m.id, turnNumber },
    });
    return m;
  });

  // Conversation history (prior turns only).
  const history = await prisma.aiMessage.findMany({
    where: { sessionId: session.id, role: { in: ["USER", "ASSISTANT"] }, id: { not: userMessage.id } },
    orderBy: { createdAt: "desc" },
    take: def.contextRules.maxConversationTurns,
    select: { role: true, content: true, interventionLevel: true, createdAt: true },
  });
  const conversation: ConversationTurn[] = history.reverse().map((h) => ({
    role: h.role === "USER" ? "user" : "assistant",
    content: h.content,
    interventionLevel: h.interventionLevel === null ? undefined : (h.interventionLevel as InterventionLevel),
    createdAt: h.createdAt.toISOString(),
  }));

  const retrieved = await retrieveFor(session.courseId, `${content} ${ctx.topicTags.join(" ")}`, ctx.allowedResourceIds);
  const directHelp = mode === "PROTECTED_ASSESSMENT" && availability.directHelp;
  const policyVersion =
    mode === "PROTECTED_ASSESSMENT"
      ? directHelp
        ? unrestrictedPolicyVersion
        : ctx.policy
          ? `${def.policyVersion}+course-v${ctx.policy.policyVersion}`
          : def.policyVersion
      : def.policyVersion;

  const envelope: AiRequestEnvelope = {
    mode,
    task: mode === "PROTECTED_ASSESSMENT" ? "socratic_turn" : mode === "PRACTICE" ? "practice_tutor_turn" : "review_turn",
    traceId: randomUUID(),
    userId: user.id,
    courseId: session.courseId,
    assignmentId: session.assignmentId,
    questionId: session.questionId,
    sessionId: session.id,
    researchCondition,
    promptTemplateId: def.promptTemplateId,
    promptVersion: def.promptVersion,
    policyVersion,
    assignmentVersion: ctx.assignmentVersion,
    questionVersion: ctx.questionVersion,
    assignment: ctx.assignment,
    policy: ctx.policy,
    workspace: ctx.workspace,
    latestExecution: ctx.latestExecution,
    retrievalScope: { courseId: session.courseId, allowedResourceIds: ctx.allowedResourceIds },
    retrievedResources: retrieved,
    conversation,
    userMessage: content,
    learnerContext: mode === "PRACTICE" ? ctx.learnerContext : null,
  };

  const failed = async (errorClass: string, aiRequestId: string): Promise<SocraSseEvent> => {
    await writeEvent(prisma, {
      eventName: "socra_response_failed",
      actorId: user.id,
      courseId: session.courseId,
      assignmentId: session.assignmentId,
      assignmentVersion: ctx.assignmentVersion,
      questionId: session.questionId,
      sessionId: session.id,
      researchCondition,
      idempotencyKey: `socra_response_failed:${userMessage.id}`,
      metadata: { mode, errorClass, ...(aiRequestId ? { aiRequestId } : {}) },
    }).catch((err: unknown) => console.error("[socra] failed to record socra_response_failed", err));
    return {
      type: "error",
      code: errorClass === "KILL_SWITCH" || errorClass === "BUDGET_EXCEEDED" ? "socra_limit" : "socra_unavailable_now",
      message: "Socra is unavailable right now. Your work is saved; you can keep editing, running and submitting.",
    };
  };

  let reply = "";
  let level: InterventionLevel | null = null;
  let aiRequestId = "";
  let policyOutcome: PolicyCheckOutcome | null = null;
  let decisionIds: string[] = [];
  let turn: ProtectedTurn | null = null;
  let fallback = false;
  let streamedLive = false;

  if (def.outputHandling.delivery === "buffered") {
    const res = await runProtectedTurn(envelope, directHelp);
    if ("error" in res) {
      yield await failed(res.error, res.aiRequestId);
      return;
    }
    reply = res.reply;
    turn = res.turn;
    aiRequestId = res.aiRequestId;
    policyOutcome = res.policyOutcome;
    decisionIds = res.decisionIds;
    fallback = res.fallback;
    const max = ctx.policy?.maxInterventionLevel ?? 5;
    level = turn ? clampLevel(turn.interventionLevel, max) : null;
  } else {
    streamedLive = true;
    for await (const chunk of streamAi(envelope, { task: envelope.task, signal })) {
      if (chunk.type === "delta") {
        reply += chunk.text;
        yield { type: "delta", text: chunk.text };
      } else if (chunk.type === "done") {
        reply = chunk.result.text;
        aiRequestId = chunk.result.aiRequestId ?? "";
      } else {
        yield await failed(chunk.error.errorClass, "");
        return;
      }
    }
  }

  // Citations: only resources that were actually retrieved for this turn.
  const retrievedById = new Map(retrieved.map((r) => [r.resourceId, r]));
  const citedIds = turn
    ? turn.citedResourceIds.filter((id) => retrievedById.has(id))
    : retrieved.filter((r) => reply.includes(r.title) || reply.includes(r.resourceId)).map((r) => r.resourceId);
  const citations = [...new Set(citedIds)].map((id) => {
    const r = retrievedById.get(id)!;
    return { resourceId: id, title: r.title, section: r.section };
  });

  // Persist assistant message, citations, events, session rollups.
  const saved = await prisma.$transaction(async (tx) => {
    const msg = await tx.aiMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content: reply,
        interventionLevel: level,
        aiRequestId: aiRequestId || null,
        metadata: {
          citations,
          policyOutcome,
          fallback,
          ...(directHelp ? { policy: "UNRESTRICTED_DIRECT_HELP" } : {}),
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    if (decisionIds.length) {
      await tx.policyDecision.updateMany({ where: { id: { in: decisionIds } }, data: { messageId: msg.id } });
    }
    for (const [rank, c] of citations.entries()) {
      const r = retrievedById.get(c.resourceId)!;
      await tx.retrievalCitation.create({
        data: {
          sessionId: session.id,
          aiRequestId: aiRequestId || null,
          messageId: msg.id,
          resourceId: r.resourceId,
          chunkId: r.chunkId,
          resourceVersion: r.resourceVersion,
          rank,
          score: r.score,
          method: r.method,
        },
      });
    }
    const usage = await tx.aiRequest.aggregate({
      where: { sessionId: session.id },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    const newMax = level !== null && !fallback ? Math.max(session.maxInterventionLevel, level) : session.maxInterventionLevel;
    await tx.aiSession.update({
      where: { id: session.id },
      data: {
        maxInterventionLevel: newMax,
        inputTokens: usage._sum.inputTokens ?? 0,
        outputTokens: usage._sum.outputTokens ?? 0,
        costUsd: usage._sum.costUsd ?? 0,
        lastActivityAt: new Date(),
        ...(level === 6 && !fallback ? { status: "ESCALATED" as const } : {}),
      },
    });

    const base = {
      actorId: user.id,
      courseId: session.courseId,
      assignmentId: session.assignmentId,
      assignmentVersion: ctx.assignmentVersion,
      questionId: session.questionId,
      questionVersion: ctx.questionVersion,
      sessionId: session.id,
      researchCondition,
      sourceTraceId: envelope.traceId,
    };
    const req = aiRequestId
      ? await tx.aiRequest.findUnique({
          where: { id: aiRequestId },
          select: { model: true, latencyMs: true, inputTokens: true, cachedTokens: true, outputTokens: true },
        })
      : null;
    await writeEvent(tx, {
      ...base,
      eventName: "socra_response_completed",
      idempotencyKey: `socra_response_completed:${msg.id}`,
      metadata: {
        mode,
        messageId: msg.id,
        aiRequestId: aiRequestId || msg.id,
        model: req?.model ?? "unknown",
        promptVersion: envelope.promptVersion,
        policyVersion,
        ...(level !== null ? { interventionLevel: level } : {}),
        latencyMs: req?.latencyMs ?? 0,
        tokenUsage: {
          inputTokens: req?.inputTokens ?? 0,
          cachedTokens: req?.cachedTokens ?? 0,
          outputTokens: req?.outputTokens ?? 0,
        },
        ...(policyOutcome ? { policyOutcome: policyOutcomeForEvent(policyOutcome) } : {}),
        retrievedResourceIds: retrieved.map((r) => r.resourceId),
      },
    });
    if (level !== null && !fallback) {
      await writeEvent(tx, {
        ...base,
        eventName: "intervention_level_assigned",
        idempotencyKey: `intervention_level_assigned:${msg.id}`,
        metadata: { messageId: msg.id, level, maxLevelInSession: newMax },
      });
    }
    for (const [rank, r] of retrieved.entries()) {
      await writeEvent(tx, {
        ...base,
        eventName: "course_resource_retrieved",
        idempotencyKey: `course_resource_retrieved:${msg.id}:${r.resourceId}:${r.chunkId ?? rank}`,
        metadata: { resourceId: r.resourceId, ...(r.chunkId ? { chunkId: r.chunkId } : {}), rank, method: r.method },
      });
    }
    if (level === 6 && !fallback && mode === "PROTECTED_ASSESSMENT") {
      const esc = await tx.socraEscalation.create({
        data: {
          sessionId: session.id,
          studentId: user.id,
          courseId: session.courseId,
          assignmentId: session.assignmentId,
          questionId: session.questionId,
        },
        select: { id: true },
      });
      await writeEvent(tx, {
        ...base,
        eventName: "socra_escalated",
        idempotencyKey: `socra_escalated:${esc.id}`,
        metadata: { escalationId: esc.id },
      });
    }
    return msg;
  });

  // Misconception candidates (probabilistic; never authoritative) -> D's observation pipeline.
  if (turn && !fallback) {
    for (const cand of turn.misconceptionCandidates.filter((c) => c.confidence >= MISCONCEPTION_CONFIDENCE_THRESHOLD)) {
      try {
        await prisma.$transaction((tx) =>
          recordMisconceptionObservation(tx, {
            userId: user.id,
            courseId: session.courseId,
            label: cand.label,
            confidence: cand.confidence,
            detectionMethod: "LLM",
            detectionVersion: envelope.promptVersion,
            modelVersion: null,
            assignmentId: session.assignmentId,
            assignmentVersion: ctx.assignmentVersion,
            questionId: session.questionId,
            aiSessionId: session.id,
            idempotencyKey: `socra-mobs:${saved.id}:${cand.label.toLowerCase().slice(0, 80)}`,
          }),
        );
      } catch (err) {
        console.error("[socra] misconception observation failed", err);
      }
    }
  }

  if (!streamedLive) {
    for (const piece of chunkText(reply)) {
      if (signal?.aborted) break;
      yield { type: "delta", text: piece };
      await sleep(8);
    }
  }
  yield {
    type: "done",
    messageId: saved.id,
    interventionLevel: level,
    citations,
    limitReached: false,
    policyOutcome,
  };
}

function policyOutcomeForEvent(o: PolicyCheckOutcome): "ALLOW" | "REVISE" | "BLOCK" | "ESCALATE" {
  return o === "REDACT" ? "REVISE" : o === "BLOCK_AND_REGENERATE" ? "BLOCK" : o;
}

// ---------------------------------------------------------------------------
// Privileged raw transcript access
// ---------------------------------------------------------------------------

export async function readRawTranscript(
  user: CurrentUser,
  sessionId: string,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  // Ordinary faculty (and anyone without a role-eligible active grant + reason) get 403 here.
  assertCan(user, "transcript:read_raw", { reason });
  const session = await prisma.aiSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      mode: true,
      assignmentId: true,
      questionId: true,
      startedAt: true,
      maxInterventionLevel: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, interventionLevel: true, createdAt: true },
      },
    },
  });
  if (!session) throw new HttpError(404, "session_not_found", "Session not found");
  const grant = await prisma.privilegedAccessGrant.findFirst({
    where: { userId: user.id, permission: "TRANSCRIPT_READ_RAW", revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { grantedAt: "desc" },
    select: { id: true },
  });
  // Audit first, in one transaction with the access log; the read only happens if both commit.
  await prisma.$transaction(async (tx) => {
    await writeAudit(
      {
        actorId: user.id,
        action: "transcript.read_raw",
        targetType: "AiSession",
        targetId: session.id,
        courseId: session.courseId,
        reason,
        metadata: { targetUserId: session.userId, grantId: grant?.id ?? null, messageCount: session.messages.length },
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      tx,
    );
    await tx.transcriptAccessLog.create({
      data: {
        accessorId: user.id,
        sessionId: session.id,
        targetUserId: session.userId,
        grantId: grant?.id ?? null,
        reason,
        ip: meta.ip ?? null,
      },
    });
  });
  return {
    session: {
      id: session.id,
      userId: session.userId,
      courseId: session.courseId,
      mode: session.mode,
      assignmentId: session.assignmentId,
      questionId: session.questionId,
      startedAt: session.startedAt.toISOString(),
      maxInterventionLevel: session.maxInterventionLevel,
    },
    messages: session.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}
