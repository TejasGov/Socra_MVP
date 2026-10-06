import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PracticeItemSource, ReviewStatus } from "@/generated/prisma/enums";
import { assertCan } from "@/server/auth/rbac";
import type { CurrentUser } from "@/server/auth/current-user";
import { prisma, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import {
  choicesForStorage,
  contentHash,
  explainWithAi,
  generatePracticeItem,
  gradeFreeResponse,
  PRACTICE_GEN_PROMPT_VERSION,
} from "./ai";
import {
  adaptDifficulty,
  checkAnswer,
  chooseTopic,
  correctChoiceIndexes,
  parseChoices,
  pickCandidate,
  shouldScaffold,
  startingDifficulty,
  acceptedAnswers,
  type AttemptResult,
} from "./logic";

const RECENT_WINDOW = 10;
const MAX_ANSWER_CHARS = 10_000;

type TopicStateLabel = "NEEDS_REINFORCEMENT" | "DEVELOPING" | "CONSISTENTLY_DEMONSTRATED";

// ---------------------------------------------------------------------------
// View types (what students receive). Never include answer/explanation before answering.
// ---------------------------------------------------------------------------

export interface PracticeItemView {
  attemptId: string;
  itemId: string;
  sessionId: string;
  topicId: string;
  topicName: string;
  type: "CODING" | "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "TRACE" | "EXPLAIN";
  difficulty: number;
  prompt: string;
  starterCode: string | null;
  language: string | null;
  choices: Array<{ id: string; text: string }> | null;
  source: PracticeItemSource;
  /** False for live-generated items that no instructor has approved yet. */
  reviewed: boolean;
  scaffold: boolean;
  scaffoldNote: string | null;
  position: number;
}

export interface NextItemResult {
  item: PracticeItemView | null;
  message: string | null;
}

export interface AnswerResult {
  attemptId: string;
  attemptNumber: number;
  /** null = not graded automatically; the student self-assesses against `correctAnswer`. */
  correct: boolean | null;
  feedback: string;
  explanation: string | null;
  correctAnswer: string | null;
  gradedBy: "AUTO" | "AI" | "SELF" | null;
  selfAssess: boolean;
  nextDifficulty: number;
  scaffoldNext: boolean;
  difficultyChange: "UP" | "DOWN" | "NONE";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSession(user: CurrentUser, sessionId: string) {
  const session = await prisma.practiceSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== user.id) {
    throw new HttpError(404, "session_not_found", "Practice session not found.");
  }
  assertCan(user, "practice:use", { courseId: session.courseId });
  return session;
}

function requireActive(status: string): void {
  if (status !== "ACTIVE") {
    throw new HttpError(409, "session_closed", "This practice session has ended. Start a new one.");
  }
}

async function topicStates(userId: string, courseId: string) {
  // Read-only view of D's LearnerTopicState; empty when nothing has been computed yet.
  try {
    return await prisma.learnerTopicState.findMany({
      where: { userId, courseId },
      select: { topicId: true, state: true, topic: { select: { name: true } } },
    });
  } catch {
    return [];
  }
}

async function gradedResults(sessionId: string, db: Pick<Tx, "practiceItemAttempt"> = prisma): Promise<AttemptResult[]> {
  const rows = await db.practiceItemAttempt.findMany({
    where: { sessionId, answeredAt: { not: null }, isCorrect: { not: null } },
    orderBy: { answeredAt: "asc" },
    select: { isCorrect: true, difficulty: true },
  });
  return rows.map((r) => ({ correct: r.isCorrect === true, difficulty: r.difficulty }));
}

function toView(
  item: {
    id: string;
    topicId: string;
    difficulty: number;
    type: PracticeItemView["type"];
    prompt: string;
    starterCode: string | null;
    language: string | null;
    choices: unknown;
    source: PracticeItemSource;
    reviewStatus: ReviewStatus;
  },
  ctx: { attemptId: string; sessionId: string; topicName: string; scaffold: boolean; position: number; level: number },
): PracticeItemView {
  const choices =
    item.type === "MULTIPLE_CHOICE"
      ? parseChoices(item.choices).map((c) => ({ id: c.id, text: c.text }))
      : null;
  return {
    attemptId: ctx.attemptId,
    itemId: item.id,
    sessionId: ctx.sessionId,
    topicId: item.topicId,
    topicName: ctx.topicName,
    type: item.type,
    difficulty: item.difficulty,
    prompt: item.prompt,
    starterCode: item.starterCode,
    language: item.language,
    choices,
    source: item.source,
    reviewed: item.reviewStatus === "APPROVED",
    scaffold: ctx.scaffold,
    scaffoldNote: ctx.scaffold
      ? "This question is a step easier than the last ones. Take it one step at a time."
      : null,
    position: ctx.position,
  };
}

function modelAnswerText(item: {
  type: string;
  answer: string | null;
  choices: unknown;
  rubric: unknown;
}): string | null {
  if (item.type === "MULTIPLE_CHOICE") {
    const choices = parseChoices(item.choices);
    const idx = correctChoiceIndexes(choices, item.answer);
    if (idx.length) return idx.map((i) => `${choices[i]!.id}. ${choices[i]!.text}`).join("; ");
  }
  const acc = acceptedAnswers(item);
  if (item.type === "SHORT_ANSWER" && acc.length) return acc[0]!;
  return item.answer;
}

// ---------------------------------------------------------------------------
// Start / overview
// ---------------------------------------------------------------------------

export interface PracticeTopicOption {
  topicId: string;
  name: string;
  state: TopicStateLabel | null;
  itemCount: number;
}

/** Topics a student can practice, with their current state (if any) and the number of approved items. */
export async function getPracticeTopics(user: CurrentUser, courseId: string): Promise<PracticeTopicOption[]> {
  assertCan(user, "practice:use", { courseId });
  const [topics, states, counts] = await Promise.all([
    prisma.topic.findMany({ where: { courseId }, orderBy: [{ order: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    topicStates(user.id, courseId),
    prisma.practiceItem.groupBy({
      by: ["topicId"],
      where: { courseId, reviewStatus: "APPROVED" },
      _count: { _all: true },
    }),
  ]);
  const stateBy = new Map(states.map((s) => [s.topicId, s.state as TopicStateLabel]));
  const countBy = new Map(counts.map((c) => [c.topicId, c._count._all]));
  const order: Record<string, number> = { NEEDS_REINFORCEMENT: 0, DEVELOPING: 1, CONSISTENTLY_DEMONSTRATED: 2 };
  return topics
    .map((t) => ({ topicId: t.id, name: t.name, state: stateBy.get(t.id) ?? null, itemCount: countBy.get(t.id) ?? 0 }))
    .sort((a, b) => (order[a.state ?? ""] ?? 1.5) - (order[b.state ?? ""] ?? 1.5));
}

export async function startPracticeSession(
  user: CurrentUser,
  input: { courseId: string; topicId?: string | null },
): Promise<{ sessionId: string; courseId: string; topicId: string | null; currentDifficulty: number }> {
  assertCan(user, "practice:use", { courseId: input.courseId });
  const topicId = input.topicId ?? null;
  let start = 2;
  if (topicId) {
    const topic = await prisma.topic.findUnique({ where: { id: topicId }, select: { courseId: true } });
    if (!topic || topic.courseId !== input.courseId) {
      throw new HttpError(400, "invalid_topic", "That topic is not part of this course.");
    }
    const st = (await topicStates(user.id, input.courseId)).find((s) => s.topicId === topicId);
    start = startingDifficulty(st?.state as TopicStateLabel | undefined);
  }
  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.practiceSession.create({
      data: { userId: user.id, courseId: input.courseId, topicId, currentDifficulty: start },
    });
    await writeEvent(tx, {
      eventName: "practice_started",
      actorId: user.id,
      courseId: input.courseId,
      sessionId: s.id,
      idempotencyKey: `practice_started:${s.id}`,
      metadata: { practiceSessionId: s.id, topicId },
    });
    return s;
  });
  return { sessionId: session.id, courseId: session.courseId, topicId, currentDifficulty: start };
}

// ---------------------------------------------------------------------------
// Next item
// ---------------------------------------------------------------------------

const ITEM_SELECT = {
  id: true,
  topicId: true,
  difficulty: true,
  type: true,
  prompt: true,
  starterCode: true,
  language: true,
  choices: true,
  source: true,
  reviewStatus: true,
  createdAt: true,
} as const;

export async function nextPracticeItem(user: CurrentUser, sessionId: string): Promise<NextItemResult> {
  const session = await loadSession(user, sessionId);
  requireActive(session.status);

  // Re-serve an unanswered item (page reload) instead of skipping it.
  const pending = await prisma.practiceItemAttempt.findFirst({
    where: { sessionId, answeredAt: null },
    orderBy: { shownAt: "desc" },
    include: { item: { select: ITEM_SELECT } },
  });
  if (pending) {
    const topic = await prisma.topic.findUnique({ where: { id: pending.item.topicId }, select: { name: true } });
    return {
      item: toView(pending.item, {
        attemptId: pending.id,
        sessionId,
        topicName: topic?.name ?? "",
        scaffold: false,
        position: session.itemsServed,
        level: session.currentDifficulty,
      }),
      message: null,
    };
  }

  const [results, recentRows, states, topics] = await Promise.all([
    gradedResults(sessionId),
    prisma.practiceItemAttempt.findMany({
      where: { userId: user.id, item: { courseId: session.courseId } },
      orderBy: { shownAt: "desc" },
      take: RECENT_WINDOW,
      select: { itemId: true },
    }),
    topicStates(user.id, session.courseId),
    prisma.topic.findMany({
      where: { courseId: session.courseId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    }),
  ]);
  if (!topics.length) return { item: null, message: "This course has no topics to practice yet." };

  const recent = new Set(recentRows.map((r) => r.itemId));
  const scaffold = shouldScaffold(results);
  const target = session.currentDifficulty;
  const reinforcement = states.filter((s) => s.state === "NEEDS_REINFORCEMENT").map((s) => s.topicId);
  const topicNameById = new Map(topics.map((t) => [t.id, t.name]));

  const withItems = new Set(
    (
      await prisma.practiceItem.groupBy({
        by: ["topicId"],
        where: { courseId: session.courseId, reviewStatus: { not: "REJECTED" } },
      })
    ).map((g) => g.topicId),
  );
  let topicId = chooseTopic({
    sessionTopicId: session.topicId,
    reinforcementTopicIds: reinforcement.filter((id) => topicNameById.has(id)),
    servedCount: session.itemsServed,
  });
  if (!topicId) {
    // No explicit topic and nothing to reinforce: rotate across topics, preferring ones that have items.
    const pool = topics.filter((t) => withItems.has(t.id));
    topicId = (pool.length ? pool : topics)[session.itemsServed % (pool.length || topics.length)]!.id;
  }
  const topic = topics.find((t) => t.id === topicId)!;

  const seed = `${sessionId}:${session.itemsServed}`;
  const items = await prisma.practiceItem.findMany({
    where: { courseId: session.courseId, topicId, reviewStatus: { not: "REJECTED" } },
    select: ITEM_SELECT,
  });
  const faculty = items.filter((i) => i.source === "FACULTY" && i.reviewStatus === "APPROVED");
  const cached = items.filter((i) => i.source !== "FACULTY" && i.reviewStatus === "APPROVED");
  const pickOpts = { target, recentItemIds: recent, seed, scaffold };

  let chosen =
    pickCandidate(faculty, pickOpts) ??
    pickCandidate(cached, pickOpts);

  if (!chosen) {
    const gen = await generatePracticeItem({
      userId: user.id,
      courseId: session.courseId,
      topicName: topic.name,
      topicDescription: topic.description,
      difficulty: target,
      scaffold,
      avoidPrompts: [],
      topicStates: states.map((s) => ({ topic: s.topic.name, state: s.state })),
    });
    if (gen.ok) {
      const g = gen.item;
      const hash = contentHash(session.courseId, topicId, g.prompt);
      const existing = await prisma.practiceItem.findUnique({
        where: { courseId_contentHash: { courseId: session.courseId, contentHash: hash } },
        select: ITEM_SELECT,
      });
      if (existing && !recent.has(existing.id) && existing.reviewStatus !== "REJECTED") {
        chosen = existing;
      } else if (!existing) {
        const created = await prisma.practiceItem.create({
          data: {
            courseId: session.courseId,
            topicId,
            difficulty: target,
            type: g.type,
            prompt: g.prompt,
            starterCode: g.starterCode,
            answer: g.answer,
            explanation: g.explanation,
            choices: (choicesForStorage(g) ?? undefined) as Prisma.InputJsonValue | undefined,
            source: "LIVE_GENERATED",
            reviewStatus: "PENDING",
            generationModel: gen.model,
            generationPromptVersion: PRACTICE_GEN_PROMPT_VERSION,
            generationRequestId: gen.aiRequestId,
            contentHash: hash,
          },
          select: ITEM_SELECT,
        });
        chosen = created;
        if (!env().AI_MOCK_MODE) {
          getQueue(QUEUE_NAMES.embeddings)
            .add("embed-practice-item", { practiceItemId: created.id })
            .catch(() => undefined);
        }
      }
    } else {
      console.warn(`[practice] live generation failed (${gen.message}); falling back to stored items`);
    }
  }

  if (!chosen) {
    // Fallbacks, best effort and never a crash: any unreviewed item on the topic, then anywhere in the course.
    chosen =
      pickCandidate(items, { ...pickOpts, maxGap: 4 }) ??
      pickCandidate(
        await prisma.practiceItem.findMany({
          where: { courseId: session.courseId, reviewStatus: { not: "REJECTED" } },
          select: ITEM_SELECT,
        }),
        { ...pickOpts, maxGap: 4 },
      ) ??
      pickCandidate(items, { ...pickOpts, maxGap: 4, allowRecent: true });
  }
  if (!chosen) {
    return {
      item: null,
      message: `No practice questions are available for ${topic.name} yet. Ask your instructor to add some, or try another topic.`,
    };
  }

  const item = chosen;
  const itemTopicName = topicNameById.get(item.topicId) ?? topic.name;
  const attempt = await prisma.$transaction(async (tx) => {
    const a = await tx.practiceItemAttempt.create({
      data: { sessionId, itemId: item.id, userId: user.id, difficulty: target },
    });
    await tx.practiceSession.update({ where: { id: sessionId }, data: { itemsServed: { increment: 1 } } });
    await writeEvent(tx, {
      eventName: "practice_item_shown",
      actorId: user.id,
      courseId: session.courseId,
      sessionId,
      idempotencyKey: `practice_item_shown:${a.id}`,
      metadata: {
        practiceSessionId: sessionId,
        itemId: item.id,
        difficulty: item.difficulty,
        source: item.source,
        topicId: item.topicId,
        scaffold,
      },
    });
    return a;
  });

  return {
    item: toView(item, {
      attemptId: attempt.id,
      sessionId,
      topicName: itemTopicName,
      scaffold,
      position: session.itemsServed + 1,
      level: target,
    }),
    message: null,
  };
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

function buildFeedback(correct: boolean | null, correctAnswer: string | null): string {
  if (correct === true) return "Correct.";
  if (correct === false) {
    return correctAnswer ? `Not quite. The expected answer is: ${correctAnswer}` : "Not quite.";
  }
  return "Compare your answer with the model answer below, then mark whether you got it.";
}

export async function submitPracticeAnswer(
  user: CurrentUser,
  input: { sessionId: string; itemId: string; answer: string; attemptId?: string; idempotencyKey?: string },
): Promise<AnswerResult> {
  const session = await loadSession(user, input.sessionId);
  requireActive(session.status);
  const answer = (input.answer ?? "").slice(0, MAX_ANSWER_CHARS);
  if (!answer.trim()) throw new HttpError(400, "empty_answer", "Enter an answer first.");

  const item = await prisma.practiceItem.findUnique({ where: { id: input.itemId } });
  if (!item || item.courseId !== session.courseId) {
    throw new HttpError(404, "item_not_found", "Practice item not found.");
  }

  if (input.idempotencyKey) {
    const prior = await prisma.practiceItemAttempt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior && prior.userId === user.id && prior.answeredAt) {
      return resultFromAttempt(prior, item, session.currentDifficulty, session.id);
    }
  }

  const attempts = await prisma.practiceItemAttempt.findMany({
    where: { sessionId: session.id, itemId: item.id },
    orderBy: { shownAt: "asc" },
  });
  if (!attempts.length) {
    throw new HttpError(409, "item_not_served", "That question was not served in this session.");
  }
  let target = input.attemptId ? attempts.find((a) => a.id === input.attemptId) : undefined;
  target ??= [...attempts].reverse().find((a) => !a.answeredAt);
  const retry = !target;
  const previous = attempts[attempts.length - 1]!;

  const check = checkAnswer(item, answer);
  let correct = check.correct;
  let gradedBy: "AUTO" | "AI" | null = check.correct === null ? null : "AUTO";
  let score: number | null = check.correct === null ? null : check.correct ? 1 : 0;
  let aiFeedback: string | null = null;
  if (correct === null) {
    const ai = await gradeFreeResponse({
      userId: user.id,
      courseId: session.courseId,
      prompt: item.prompt,
      modelAnswer: item.answer,
      rubric: item.rubric,
      answer,
    });
    if (ai) {
      correct = ai.correct;
      score = ai.score;
      gradedBy = "AI";
      aiFeedback = ai.feedback;
    }
  }
  const correctAnswer = modelAnswerText(item);
  const feedback = aiFeedback
    ? `${correct ? "Correct. " : "Not quite. "}${aiFeedback}`
    : buildFeedback(correct, correctAnswer);

  const out = await prisma.$transaction(async (tx) => {
    const base = {
      answer,
      isCorrect: correct,
      score,
      feedback,
      gradedBy,
      answeredAt: new Date(),
      idempotencyKey: input.idempotencyKey ?? null,
    };
    const attempt = retry
      ? await tx.practiceItemAttempt.create({
          data: {
            sessionId: session.id,
            itemId: item.id,
            userId: user.id,
            difficulty: session.currentDifficulty,
            attemptNumber: previous.attemptNumber + 1,
            assisted: previous.assisted,
            explanationRequested: previous.explanationRequested,
            ...base,
          },
        })
      : await tx.practiceItemAttempt.update({
          where: { id: target!.id },
          data: { ...base, assisted: target!.assisted || target!.explanationRequested },
        });

    let nextDifficulty = session.currentDifficulty;
    let scaffoldNext = false;
    let change: "UP" | "DOWN" | "NONE" = "NONE";
    if (correct !== null) {
      const adapt = adaptDifficulty(session.currentDifficulty, await gradedResults(session.id, tx));
      nextDifficulty = adapt.difficulty;
      scaffoldNext = adapt.scaffold;
      change = adapt.changed;
    }
    await tx.practiceSession.update({
      where: { id: session.id },
      data: {
        currentDifficulty: nextDifficulty,
        ...(correct === true ? { correctCount: { increment: 1 } } : {}),
      },
    });
    if (correct !== null) {
      await writeEvent(tx, {
        eventName: "practice_answered",
        actorId: user.id,
        courseId: session.courseId,
        sessionId: session.id,
        idempotencyKey: `practice_answered:${attempt.id}`,
        metadata: {
          practiceSessionId: session.id,
          itemId: item.id,
          attemptId: attempt.id,
          isCorrect: correct,
          attemptNumber: attempt.attemptNumber,
          assisted: attempt.assisted || attempt.explanationRequested,
          topicId: item.topicId,
          itemDifficulty: item.difficulty,
          source: item.source,
          gradedBy,
          score,
        },
      });
    }
    return { attempt, nextDifficulty, scaffoldNext, change };
  });

  return {
    attemptId: out.attempt.id,
    attemptNumber: out.attempt.attemptNumber,
    correct,
    feedback,
    explanation: item.explanation,
    correctAnswer,
    gradedBy,
    selfAssess: correct === null,
    nextDifficulty: out.nextDifficulty,
    scaffoldNext: out.scaffoldNext,
    difficultyChange: out.change,
  };
}

function resultFromAttempt(
  a: { id: string; attemptNumber: number; isCorrect: boolean | null; feedback: string | null; gradedBy: string | null },
  item: { explanation: string | null; type: string; answer: string | null; choices: unknown; rubric: unknown },
  currentDifficulty: number,
  _sessionId: string,
): AnswerResult {
  return {
    attemptId: a.id,
    attemptNumber: a.attemptNumber,
    correct: a.isCorrect,
    feedback: a.feedback ?? "",
    explanation: item.explanation,
    correctAnswer: modelAnswerText(item),
    gradedBy: (a.gradedBy as AnswerResult["gradedBy"]) ?? null,
    selfAssess: a.isCorrect === null,
    nextDifficulty: currentDifficulty,
    scaffoldNext: false,
    difficultyChange: "NONE",
  };
}

/** Free-response items the system could not grade: the student marks their own answer after seeing the model answer. */
export async function submitSelfAssessment(
  user: CurrentUser,
  input: { sessionId: string; attemptId: string; correct: boolean },
): Promise<AnswerResult> {
  const session = await loadSession(user, input.sessionId);
  requireActive(session.status);
  const attempt = await prisma.practiceItemAttempt.findUnique({
    where: { id: input.attemptId },
    include: { item: true },
  });
  if (!attempt || attempt.sessionId !== session.id || attempt.userId !== user.id) {
    throw new HttpError(404, "attempt_not_found", "Attempt not found.");
  }
  if (!attempt.answeredAt) throw new HttpError(409, "not_answered", "Answer the question first.");
  if (attempt.isCorrect !== null) throw new HttpError(409, "already_graded", "This answer is already graded.");

  const out = await prisma.$transaction(async (tx) => {
    const updated = await tx.practiceItemAttempt.update({
      where: { id: attempt.id },
      data: {
        isCorrect: input.correct,
        score: input.correct ? 1 : 0,
        gradedBy: "SELF",
        feedback: input.correct ? "Marked correct by you." : "Marked not yet correct by you.",
      },
    });
    const adapt = adaptDifficulty(session.currentDifficulty, await gradedResults(session.id, tx));
    await tx.practiceSession.update({
      where: { id: session.id },
      data: {
        currentDifficulty: adapt.difficulty,
        ...(input.correct ? { correctCount: { increment: 1 } } : {}),
      },
    });
    await writeEvent(tx, {
      eventName: "practice_answered",
      actorId: user.id,
      courseId: session.courseId,
      sessionId: session.id,
      idempotencyKey: `practice_answered:${attempt.id}`,
      metadata: {
        practiceSessionId: session.id,
        itemId: attempt.itemId,
        attemptId: attempt.id,
        isCorrect: input.correct,
        attemptNumber: attempt.attemptNumber,
        assisted: attempt.assisted || attempt.explanationRequested,
        topicId: attempt.item.topicId,
        itemDifficulty: attempt.item.difficulty,
        source: attempt.item.source,
        gradedBy: "SELF",
        score: input.correct ? 1 : 0,
      },
    });
    return { updated, adapt };
  });

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    correct: input.correct,
    feedback: out.updated.feedback ?? "",
    explanation: attempt.item.explanation,
    correctAnswer: modelAnswerText(attempt.item),
    gradedBy: "SELF",
    selfAssess: false,
    nextDifficulty: out.adapt.difficulty,
    scaffoldNext: out.adapt.scaffold,
    difficultyChange: out.adapt.changed,
  };
}

// ---------------------------------------------------------------------------
// Explanation (practice may reveal complete answers)
// ---------------------------------------------------------------------------

export async function requestExplanation(
  user: CurrentUser,
  input: { sessionId: string; itemId: string },
): Promise<{ explanation: string; correctAnswer: string | null; source: "AI" | "STORED"; aiRequestId: string | null }> {
  const session = await loadSession(user, input.sessionId);
  const item = await prisma.practiceItem.findUnique({
    where: { id: input.itemId },
    include: { topic: { select: { name: true } } },
  });
  if (!item || item.courseId !== session.courseId) {
    throw new HttpError(404, "item_not_found", "Practice item not found.");
  }
  const attempt = await prisma.practiceItemAttempt.findFirst({
    where: { sessionId: session.id, itemId: item.id },
    orderBy: { shownAt: "desc" },
  });
  if (!attempt) throw new HttpError(409, "item_not_served", "That question was not served in this session.");

  await prisma.$transaction(async (tx) => {
    await tx.practiceItemAttempt.update({
      where: { id: attempt.id },
      data: { explanationRequested: true, assisted: true },
    });
    await writeEvent(tx, {
      eventName: "explanation_requested",
      actorId: user.id,
      courseId: session.courseId,
      sessionId: session.id,
      idempotencyKey: `explanation_requested:${attempt.id}`,
      metadata: { practiceSessionId: session.id, itemId: item.id, topicId: item.topicId },
    });
  });

  const correctAnswer = modelAnswerText(item);
  const stored = [item.explanation, correctAnswer ? `Answer: ${correctAnswer}` : null].filter(Boolean).join("\n\n");

  // Mock mode: the stored explanation is more useful than a canned reply.
  if (!(env().AI_MOCK_MODE && item.explanation)) {
    const ai = await explainWithAi({
      userId: user.id,
      courseId: session.courseId,
      prompt: item.prompt,
      modelAnswer: item.answer,
      storedExplanation: item.explanation,
      studentAnswer: attempt.answer,
      topicName: item.topic.name,
    });
    if (ai) return { explanation: ai.text, correctAnswer, source: "AI", aiRequestId: ai.aiRequestId };
  }
  return {
    explanation: stored || "No written explanation is stored for this question yet.",
    correctAnswer,
    source: "STORED",
    aiRequestId: null,
  };
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export interface PracticeSummary {
  sessionId: string;
  status: string;
  itemsServed: number;
  answered: number;
  correctCount: number;
  topics: Array<{ topicId: string; name: string; answered: number; correct: number }>;
  followUps: Array<{ topicId: string; name: string; reason: string }>;
}

export async function completePracticeSession(user: CurrentUser, sessionId: string): Promise<PracticeSummary> {
  const session = await loadSession(user, sessionId);
  if (session.status === "ACTIVE") {
    await prisma.$transaction(async (tx) => {
      await tx.practiceSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", endedAt: new Date() },
      });
      await writeEvent(tx, {
        eventName: "practice_completed",
        actorId: user.id,
        courseId: session.courseId,
        sessionId,
        idempotencyKey: `practice_completed:${sessionId}`,
        metadata: {
          practiceSessionId: sessionId,
          itemsServed: session.itemsServed,
          correctCount: session.correctCount,
        },
      });
    });
  }
  const fresh = await prisma.practiceSession.findUniqueOrThrow({ where: { id: sessionId } });
  const attempts = await prisma.practiceItemAttempt.findMany({
    where: { sessionId, answeredAt: { not: null } },
    select: { isCorrect: true, item: { select: { topicId: true, topic: { select: { name: true } } } } },
  });
  const by = new Map<string, { name: string; answered: number; correct: number }>();
  for (const a of attempts) {
    const e = by.get(a.item.topicId) ?? { name: a.item.topic.name, answered: 0, correct: 0 };
    e.answered++;
    if (a.isCorrect) e.correct++;
    by.set(a.item.topicId, e);
  }
  const topics = [...by.entries()].map(([topicId, v]) => ({ topicId, ...v }));
  const followUps = topics
    .filter((t) => t.answered >= 2 && t.correct / t.answered < 0.5)
    .map((t) => ({
      topicId: t.topicId,
      name: t.name,
      reason: `You answered ${t.correct} of ${t.answered} correctly. Practice it again with an easier start.`,
    }));
  return {
    sessionId,
    status: fresh.status,
    itemsServed: fresh.itemsServed,
    answered: attempts.length,
    correctCount: fresh.correctCount,
    topics,
    followUps,
  };
}

// ---------------------------------------------------------------------------
// Similar items (embedding column, when populated)
// ---------------------------------------------------------------------------

/** Items closest to `itemId` by cosine distance within the same course. Empty when the item has no embedding yet. */
export async function findSimilarPracticeItems(
  courseId: string,
  itemId: string,
  limit = 3,
): Promise<Array<{ id: string; prompt: string; difficulty: number }>> {
  return prisma.$queryRaw<Array<{ id: string; prompt: string; difficulty: number }>>`
    SELECT p.id, p.prompt, p.difficulty
    FROM "PracticeItem" p, "PracticeItem" src
    WHERE src.id = ${itemId} AND src."courseId" = ${courseId} AND src.embedding IS NOT NULL
      AND p."courseId" = ${courseId} AND p.id <> src.id AND p.embedding IS NOT NULL
      AND p."reviewStatus" <> 'REJECTED'
    ORDER BY p.embedding <=> src.embedding ASC
    LIMIT ${limit}`;
}
