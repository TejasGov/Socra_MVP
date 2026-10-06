import "server-only";
import { createHash } from "node:crypto";
import {
  EMBEDDING_DIMENSIONS,
  type AiProvider,
  type AiResult,
  type AiStreamChunk,
  type EmbedOptions,
  type ProviderRequest,
} from "../types";
import {
  mockAnalyticsBrief,
  mockAuthoring,
  mockGrading,
  mockPractice,
  mockPracticeGrade,
  mockPracticeItem,
  mockReview,
} from "./mock-modes";
import { mockProtectedTurn } from "./mock-protected";
import { seededRng, sha256 } from "./mock-util";

/**
 * MockAiProvider — deterministic, credential-free provider used when AI_MOCK_MODE is on.
 *
 * Same request -> same output: a PRNG seeded by a hash of the inputs (mode, task, message, code, latest run,
 * conversation) only varies phrasing. Behavior per mode:
 *   PROTECTED_ASSESSMENT    Socratic ladder from the real workspace code, error text and failing public tests
 *   PRACTICE                direct explanations with a worked example
 *   POST_ASSESSMENT_REVIEW  line-by-line walk-through of the released reference solution
 *   FACULTY_AUTHORING       schema-valid assignment suggestion from topic keywords (or a grading suggestion)
 *   FACULTY_ANALYTICS       summary that only restates the numbers it was given
 * Streams in word chunks with small delays.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "MOCK" as const;

  constructor(private readonly opts: { chunkDelayMs?: number } = {}) {}

  async generate(req: ProviderRequest): Promise<AiResult> {
    const started = Date.now();
    const { text, structured } = mockOutput(req);
    const prefixChars = req.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .reduce((n, m) => n + m.content.length, 0);
    const inputChars = req.messages.reduce((n, m) => n + m.content.length, 0);
    const inputTokens = Math.ceil(inputChars / 4);
    return {
      text,
      structured,
      usage: {
        inputTokens,
        // Emulate prompt caching: the stable prefix is cached once the conversation has history.
        cachedTokens: req.envelope.conversation.length > 0 ? Math.min(inputTokens, Math.floor(prefixChars / 4)) : 0,
        outputTokens: Math.ceil(text.length / 4),
        reasoningTokens: 0,
      },
      model: `mock-${req.tier}`,
      provider: "MOCK",
      providerRequestId: `mock_${seedFor(req).slice(0, 16)}`,
      latencyMs: Date.now() - started,
      finishReason: "stop",
    };
  }

  async *stream(req: ProviderRequest): AsyncIterable<AiStreamChunk> {
    const result = await this.generate(req);
    const delay = this.opts.chunkDelayMs ?? (process.env.NODE_ENV === "test" ? 0 : 15);
    const pieces = result.text.match(/\S+\s*|\s+/g) ?? [];
    for (let i = 0; i < pieces.length; i += 3) {
      if (req.signal?.aborted) return;
      yield { type: "delta", text: pieces.slice(i, i + 3).join("") };
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    yield { type: "done", result };
  }

  async embed(texts: string[], _opts: EmbedOptions): Promise<number[][]> {
    return texts.map((t) => hashEmbedding(t));
  }
}

/** Seed = hash of everything that should change the answer. */
export function seedFor(req: ProviderRequest): string {
  const e = req.envelope;
  return sha256(
    JSON.stringify([
      e.mode,
      e.task,
      e.userMessage,
      e.workspace?.code ?? "",
      e.latestExecution?.stderr ?? "",
      e.latestExecution?.status ?? "",
      e.conversation.map((t) => t.content),
      e.assignment?.assignmentId ?? "",
      req.structuredOutput?.name ?? "",
    ]),
  );
}

export function mockOutput(req: ProviderRequest): { text: string; structured?: unknown } {
  const env = req.envelope;
  const rng = seededRng(seedFor(req));
  const structuredName = req.structuredOutput?.name;

  if (env.task === "grading_suggestion" || structuredName === "written_grade_suggestion") {
    const s = mockGrading(env);
    return { text: JSON.stringify(s), structured: s };
  }
  if (env.task === "practice_generation" && structuredName) {
    const item = mockPracticeItem(env, rng);
    return { text: JSON.stringify(item), structured: item };
  }
  if (env.task === "practice_grading" && structuredName) {
    const g = mockPracticeGrade(env);
    return { text: JSON.stringify(g), structured: g };
  }
  switch (env.mode) {
    case "PROTECTED_ASSESSMENT": {
      const turn = mockProtectedTurn(env, rng);
      return structuredName ? { text: JSON.stringify(turn), structured: turn } : { text: turn.reply };
    }
    case "PRACTICE":
      return { text: mockPractice(env, rng) };
    case "POST_ASSESSMENT_REVIEW":
      return { text: mockReview(env) };
    case "FACULTY_AUTHORING": {
      const s = mockAuthoring(env);
      return { text: JSON.stringify(s), structured: s };
    }
    case "FACULTY_ANALYTICS":
      return { text: mockAnalyticsBrief(env) };
  }
}

/** Deterministic unit-length pseudo-embedding from token hashes (bag of hashed words). */
export function hashEmbedding(text: string, dims = EMBEDDING_DIMENSIONS): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    const h = createHash("sha256").update(word).digest();
    const idx = h.readUInt32BE(0) % dims;
    v[idx] = (v[idx] ?? 0) + ((h[4] ?? 0) % 2 === 0 ? 1 : -1);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
