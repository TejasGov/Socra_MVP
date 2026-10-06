import type { AiMode } from "@/generated/prisma/enums";
import { sid } from "./context";
import type { Turn } from "./data/dialogues";
import { type Acc, type CourseKey, type Student, words } from "./sim";
import { intBetween, between, MIN_MS, S, type AssignmentRef, type QuestionRef } from "./state";

const IN_PRICE = 0.15;
const CACHED_PRICE = 0.075;
const OUT_PRICE = 0.6;

export interface AiSessionParams {
  acc: Acc;
  st: Student;
  courseKey: CourseKey;
  courseId: string;
  mode: AiMode;
  assignment?: AssignmentRef;
  question?: QuestionRef;
  practiceSessionId?: string;
  topicKey: string;
  turns: Turn[];
  startMs: number;
  r: () => number;
  key: string;
  forceStatus?: "ESCALATED";
  escalationNote?: string;
  firstReplyRevised?: boolean;
}

export interface AiSessionResult {
  sessionId: string;
  endMs: number;
  maxLevel: number;
  turnCount: number;
  firstEventId: string;
}

function pickChunk(courseKey: CourseKey, topicKey: string, r: () => number) {
  const res = S.resources.find(
    (x) =>
      x.def.courseKey === courseKey &&
      x.def.accessScope === "COURSE_ALL" &&
      x.def.topics.includes(topicKey),
  );
  if (!res || res.chunks.length === 0) return null;
  const chunk = res.chunks[Math.floor(r() * res.chunks.length)];
  return chunk ? { res, chunk } : null;
}

export function buildAiSession(p: AiSessionParams): AiSessionResult {
  const { acc, st, r } = p;
  const sessionId = sid("aisess", p.key);
  const cap = p.assignment?.def.policyMaxLevel ?? 5;
  const unrestricted = st.condition === "UNRESTRICTED_AI";
  const sectionId = st.section[p.courseKey]
    ? sid("section", p.courseKey, st.section[p.courseKey] as string)
    : null;
  const asgVersion = p.assignment?.version ?? null;
  const evBase = {
    actorId: st.id,
    courseId: p.courseId,
    sectionId,
    assignmentId: p.assignment?.id ?? null,
    assignmentVersion: asgVersion,
    questionId: p.question?.id ?? null,
    questionVersion: p.question ? 1 : null,
    sessionId,
    condition: st.condition,
  };

  let t = p.startMs;
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  let maxLevel = 0;
  let firstEventId = "";

  const startId = acc.events.add({
    ...evBase,
    name: "socra_session_started",
    key: `sess_start:${p.key}`,
    at: new Date(t),
    metadata: { mode: p.mode, policyVersion: p.assignment?.policyVersion ?? 1 },
  });
  firstEventId = startId;

  p.turns.forEach((turn, i) => {
    const k = i + 1;
    const userMsgId = sid("aimsg", p.key, k, "u");
    const asstMsgId = sid("aimsg", p.key, k, "a");
    const reqId = sid("aireq", p.key, k);
    const level =
      turn.level === 6
        ? 6
        : Math.min(cap, unrestricted && turn.level > 0 ? turn.level + 2 : turn.level);
    maxLevel = Math.max(maxLevel, level);

    const latency = intBetween(r, 650, 2600);
    const inputTokens = 700 + 260 * k + intBetween(r, 0, 220);
    const cachedTokens = k > 1 ? 480 : 0;
    const outputTokens = Math.round(40 + words(turn.r) * 1.35);
    const reqCost =
      ((inputTokens - cachedTokens) * IN_PRICE +
        cachedTokens * CACHED_PRICE +
        outputTokens * OUT_PRICE) /
      1_000_000;
    inTok += inputTokens;
    outTok += outputTokens;
    cost += reqCost;

    const outcome =
      turn.level === 6 ? "ESCALATE" : p.firstReplyRevised && i === 0 ? "REVISE" : "ALLOW";

    // retrieval (about 40% of turns at levels 1-3 when the policy allows it)
    let citationMeta: Array<{ resourceId: string; title: string; section: string | null }> = [];
    const retrievedIds: string[] = [];
    const wantsRetrieval =
      p.assignment?.def.format !== "QUIZ" && level >= 1 && level <= 3 && r() < 0.4;
    const hit = wantsRetrieval ? pickChunk(p.courseKey, p.topicKey, r) : null;

    const promptEvent = acc.events.add({
      ...evBase,
      name: "socra_prompt_sent",
      key: `prompt:${p.key}:${k}`,
      at: new Date(t),
      metadata: { mode: p.mode, messageId: userMsgId, turnNumber: k },
    });

    acc.messages.push({
      id: userMsgId,
      sessionId,
      role: "USER",
      content: turn.s,
      createdAt: new Date(t),
    });

    t += between(r, 900, 2200) | 0;
    if (hit) {
      retrievedIds.push(hit.res.id);
      citationMeta = [
        {
          resourceId: hit.res.id,
          title: hit.res.def.title,
          section: hit.chunk.heading.split(" > ")[1] ?? null,
        },
      ];
      acc.citations.push({
        id: sid("cite", p.key, k),
        sessionId,
        aiRequestId: reqId,
        messageId: asstMsgId,
        resourceId: hit.res.id,
        chunkId: hit.chunk.id,
        resourceVersion: 1,
        rank: 0,
        score: Math.round(between(r, 0.42, 0.91) * 1000) / 1000,
        method: "FULL_TEXT",
        embeddingModel: null,
        createdAt: new Date(t),
      });
      acc.events.add({
        ...evBase,
        name: "course_resource_retrieved",
        key: `retr:${p.key}:${k}`,
        at: new Date(t),
        metadata: { resourceId: hit.res.id, chunkId: hit.chunk.id, rank: 0, method: "FULL_TEXT" },
      });
    }

    const doneAt = t + latency;
    acc.aiRequests.push({
      id: reqId,
      sessionId,
      userId: st.id,
      courseId: p.courseId,
      assignmentId: p.assignment?.id ?? null,
      questionId: p.question?.id ?? null,
      mode: p.mode,
      task: p.mode === "PRACTICE" ? "practice_tutor_turn" : "socratic_turn",
      provider: "MOCK",
      model: "mock-socra-1",
      traceId: sid("trace", p.key, k),
      promptTemplateId: p.mode === "PRACTICE" ? "practice-tutor" : "protected-socratic",
      promptVersion: p.mode === "PRACTICE" ? "practice-v1" : "protected-v1",
      policyVersion: "1",
      assignmentVersion: asgVersion,
      questionVersion: p.question ? 1 : null,
      researchCondition: st.condition,
      status: "SUCCEEDED",
      latencyMs: latency,
      firstTokenMs: Math.round(latency * between(r, 0.2, 0.45)),
      inputTokens,
      cachedTokens,
      outputTokens,
      reasoningTokens: 0,
      costUsd: reqCost.toFixed(6),
      appVersion: "0.1.0",
      retrievedResourceIds: retrievedIds,
      structuredOutputValid: null,
      retryCount: 0,
      fallbackUsed: false,
      routingReason: "tier:protected",
      createdAt: new Date(t),
      completedAt: new Date(doneAt),
    });
    acc.messages.push({
      id: asstMsgId,
      sessionId,
      role: "ASSISTANT",
      content: turn.r,
      interventionLevel: level,
      metadata: { citations: citationMeta, policyOutcome: outcome },
      aiRequestId: reqId,
      createdAt: new Date(doneAt),
    });
    acc.decisions.push({
      id: sid("pdec", p.key, k),
      sessionId,
      aiRequestId: reqId,
      messageId: asstMsgId,
      mode: p.mode,
      policyVersion: "1",
      checker: "rules-v1",
      outcome,
      checks: [
        {
          check: "no_complete_solution",
          passed: outcome !== "REVISE",
          detail: outcome === "REVISE" ? "Draft reply revised before sending" : "ok",
        },
        { check: "no_hidden_test_disclosure", passed: true, detail: "ok" },
        {
          check: "level_within_policy_cap",
          passed: level <= Math.max(cap, 6),
          detail: `level ${level}, cap ${cap}`,
        },
      ],
      reasons:
        outcome === "REVISE"
          ? ["student requested full solution"]
          : outcome === "ESCALATE"
            ? ["distress language detected"]
            : [],
      interventionLevel: level,
      createdAt: new Date(doneAt),
    });

    acc.events.add({
      ...evBase,
      name: "socra_response_completed",
      key: `resp:${p.key}:${k}`,
      at: new Date(doneAt),
      metadata: {
        mode: p.mode,
        messageId: asstMsgId,
        aiRequestId: reqId,
        model: "mock-socra-1",
        promptVersion: p.mode === "PRACTICE" ? "practice-v1" : "protected-v1",
        policyVersion: "1",
        interventionLevel: level,
        latencyMs: latency,
        tokenUsage: { inputTokens, cachedTokens, outputTokens },
        policyOutcome: outcome,
        retrievedResourceIds: retrievedIds,
      },
    });
    acc.events.add({
      ...evBase,
      name: "intervention_level_assigned",
      key: `level:${p.key}:${k}`,
      at: new Date(doneAt + 50),
      metadata: { messageId: asstMsgId, level, maxLevelInSession: maxLevel },
    });
    void promptEvent;
    t = doneAt + intBetween(r, 35_000, 140_000);
  });

  const endMs = t;
  acc.aiSessions.push({
    id: sessionId,
    userId: st.id,
    courseId: p.courseId,
    mode: p.mode,
    assignmentId: p.assignment?.id ?? null,
    questionId: p.question?.id ?? null,
    practiceSessionId: p.practiceSessionId ?? null,
    assignmentVersion: asgVersion,
    policyVersion: 1,
    researchCondition: st.condition,
    status: p.forceStatus ?? "ENDED",
    maxInterventionLevel: maxLevel,
    turnCount: p.turns.length,
    inputTokens: inTok,
    outputTokens: outTok,
    costUsd: cost.toFixed(6),
    startedAt: new Date(p.startMs),
    lastActivityAt: new Date(endMs),
    endedAt: new Date(endMs),
  });

  if (p.forceStatus === "ESCALATED") {
    const escId = sid("esc", p.key);
    acc.escalations.push({
      id: escId,
      sessionId,
      studentId: st.id,
      courseId: p.courseId,
      assignmentId: p.assignment?.id ?? null,
      questionId: p.question?.id ?? null,
      note: p.escalationNote ?? null,
      status: st.n === 3 ? "OPEN" : "RESOLVED",
      resolvedById: st.n === 3 ? null : null,
      createdAt: new Date(endMs - MIN_MS),
      resolvedAt: st.n === 3 ? null : new Date(endMs + 20 * 3600_000),
    });
    acc.events.add({
      ...evBase,
      name: "socra_escalated",
      key: `escalated:${p.key}`,
      at: new Date(endMs - MIN_MS),
      metadata: { escalationId: escId },
    });
  }
  return { sessionId, endMs, maxLevel, turnCount: p.turns.length, firstEventId };
}
