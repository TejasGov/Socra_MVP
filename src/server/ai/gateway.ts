import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { AiRequestStatus } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { env } from "../env";
import { priceTableFromEnv, computeCostUsd, computeEmbeddingCostUsd } from "./cost";
import { applyContextRules, assembleMessages, getModeDefinition } from "./modes";
import { getAiProvider, modelForTier, TASK_TIERS } from "./provider";
import { parseStructured, toStructuredOutputSpec } from "./structured";
import {
  AiProviderError,
  type AiErrorClass,
  type AiErrorInfo,
  type AiProvider,
  type AiRequestEnvelope,
  type AiResult,
  type AiStreamChunk,
  type AiTask,
  type AiUsage,
  type ModelTier,
  type ProviderRequest,
} from "./types";

/**
 * AI gateway — the ONLY entry point the app uses for model calls (TASK §12, contract in docs/_CONTRACTS.md).
 *
 *   envelope -> mode context rules -> prompt assembly (stable prefix first) -> model routing by task tier
 *   -> provider call with timeout + ONE retry for transient errors -> zod validation of structured output
 *   (ONE retry on malformed output) -> AiRequest persistence (usage, cost, latency, versions, status).
 *
 * Never throws for provider failures: errors come back as `{ ok: false, errorClass }` / `{ type: "error" }`.
 * Policy checks for protected mode are applied by the Socra service on top of `runAi` (src/server/ai/policy-check.ts).
 */

export type GatewayErrorClass = AiErrorClass | "INVALID_OUTPUT";

export type RunAiResult<T> =
  | { ok: true; text: string; structured?: T; aiRequestId: string; model: string; usage: AiUsage; latencyMs: number }
  | { ok: false; errorClass: GatewayErrorClass; message: string; aiRequestId: string };

export interface RunAiOptions<T> {
  task: AiTask;
  schema?: z.ZodType<T>;
  maxOutputTokens?: number;
  /** Extra developer instruction appended after context (e.g. policy regeneration feedback). */
  extraInstruction?: string;
  signal?: AbortSignal;
}

export interface StreamAiOptions {
  task: AiTask;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

const STUDENT_FALLBACK_MESSAGE =
  "Socra is unavailable right now. Your work is saved; you can keep editing, running and submitting.";

// ---------------------------------------------------------------------------
// Request assembly
// ---------------------------------------------------------------------------

export function buildProviderRequest(
  envelope: AiRequestEnvelope,
  opts: { task: AiTask; maxOutputTokens?: number; structured?: z.ZodType; extraInstruction?: string; signal?: AbortSignal },
): { request: ProviderRequest; envelope: AiRequestEnvelope } {
  const def = getModeDefinition(envelope.mode);
  const e = env();
  let safe = applyContextRules(def.contextRules, { ...envelope, task: opts.task });
  // Input budget guard: drop oldest conversation turns until the rough token estimate fits.
  const estimate = (env2: AiRequestEnvelope) =>
    Math.ceil(assembleMessages(def, env2).reduce((n, m) => n + m.content.length, 0) / 4);
  while (safe.conversation.length > 0 && estimate(safe) > e.AI_MAX_INPUT_TOKENS_PER_REQUEST) {
    safe = { ...safe, conversation: safe.conversation.slice(1) };
  }
  const messages = assembleMessages(def, safe);
  if (opts.extraInstruction) {
    messages.splice(messages.length - 1, 0, { role: "developer", content: opts.extraInstruction });
  }
  const tier = TASK_TIERS[opts.task];
  // Whole-artifact generations (a full assignment or quiz, a practice item, a grading suggestion) take far longer
  // on a reasoning model than a single tutoring turn, so they get their own timeout.
  const timeoutMs = LONG_GENERATION_TASKS.has(opts.task)
    ? Math.max(e.OPENAI_TIMEOUT_MS, e.OPENAI_LONG_TIMEOUT_MS)
    : e.OPENAI_TIMEOUT_MS;
  const request: ProviderRequest = {
    envelope: safe,
    model: modelForTier(tier),
    tier,
    messages,
    maxOutputTokens: Math.min(opts.maxOutputTokens ?? def.outputHandling.maxOutputTokens, 8000),
    structuredOutput: opts.structured
      ? toStructuredOutputSpec(def.outputHandling.schemaName ?? opts.task, opts.structured)
      : undefined,
    reasoningEffort: tier === "protected" ? e.OPENAI_REASONING_EFFORT_PROTECTED : e.OPENAI_REASONING_EFFORT_ECONOMY,
    timeoutMs,
    signal: opts.signal,
  };
  return { request, envelope: safe };
}

// ---------------------------------------------------------------------------
// Core execution (pure w.r.t. persistence; unit-tested with fake providers)
// ---------------------------------------------------------------------------

export interface ExecutionOutcome<T> {
  ok: boolean;
  result: AiResult | null;
  structured?: T;
  errorClass: GatewayErrorClass | null;
  message: string;
  retryCount: number;
  structuredOutputValid: boolean | null;
  /** Usage summed across attempts (all attempts are billed). */
  usage: AiUsage;
  latencyMs: number;
}

const zeroUsage = (): AiUsage => ({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 });
const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export function toProviderError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  return new AiProviderError("UNKNOWN", err instanceof Error ? err.message : String(err), false);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new AiProviderError("TIMEOUT", `no response within ${ms}ms`, true)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Provider call with timeout, one transient retry, and one retry for malformed structured output. */
export async function executeWithRetries<T>(
  provider: AiProvider,
  request: ProviderRequest,
  schema?: z.ZodType<T>,
): Promise<ExecutionOutcome<T>> {
  const started = Date.now();
  let usage = zeroUsage();
  let retryCount = 0;
  let transientRetried = false;
  let schemaRetried = false;
  let lastError: AiProviderError | null = null;
  let lastResult: AiResult | null = null;

  for (;;) {
    try {
      const result = await withTimeout(provider.generate(request), request.timeoutMs + 1000);
      usage = addUsage(usage, result.usage);
      lastResult = result;
      if (!schema) {
        return { ok: true, result, errorClass: null, message: "", retryCount, structuredOutputValid: null, usage, latencyMs: Date.now() - started };
      }
      const parsed = parseStructured(schema, result.structured, result.text);
      if (parsed.ok) {
        return {
          ok: true,
          result,
          structured: parsed.value,
          errorClass: null,
          message: "",
          retryCount,
          structuredOutputValid: true,
          usage,
          latencyMs: Date.now() - started,
        };
      }
      if (!schemaRetried) {
        schemaRetried = true;
        retryCount++;
        continue;
      }
      return {
        ok: false,
        result,
        errorClass: "INVALID_OUTPUT",
        message: `structured output failed validation: ${parsed.error}`,
        retryCount,
        structuredOutputValid: false,
        usage,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      lastError = toProviderError(err);
      if (lastError.retryable && !transientRetried) {
        transientRetried = true;
        retryCount++;
        continue;
      }
      return {
        ok: false,
        result: lastResult,
        errorClass: lastError.errorClass,
        message: lastError.message,
        retryCount,
        structuredOutputValid: schema ? false : null,
        usage,
        latencyMs: Date.now() - started,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface PersistAiRequestInput {
  envelope: AiRequestEnvelope;
  task: AiTask;
  tier: ModelTier;
  provider: "MOCK" | "OPENAI";
  model: string;
  providerRequestId: string | null;
  status: AiRequestStatus;
  errorClass: GatewayErrorClass | null;
  errorMessage: string | null;
  latencyMs: number;
  firstTokenMs?: number | null;
  usage: AiUsage;
  retryCount: number;
  structuredOutputValid: boolean | null;
  fallbackUsed?: boolean;
  routingReason?: string | null;
}

/** Prisma enum has SCHEMA_VALIDATION; the contract's INVALID_OUTPUT maps onto it. */
function dbErrorClass(c: GatewayErrorClass | null): AiErrorClass | null {
  if (c === null) return null;
  return c === "INVALID_OUTPUT" ? "SCHEMA_VALIDATION" : c;
}

const LONG_GENERATION_TASKS: ReadonlySet<AiTask> = new Set<AiTask>([
  "authoring_generation",
  "practice_generation",
  "grading_suggestion",
]);

/**
 * Price by the model that actually ran, not by the routing tier: the protected tier can be pointed at the economy
 * model (OPENAI_PROTECTED_MODEL=OPENAI_ECONOMY_MODEL) and must then be billed at economy rates.
 */
export function pricingTierFor(tier: ModelTier, model: string | undefined, e = env()): ModelTier {
  if (!model) return tier;
  if (model === e.OPENAI_EMBEDDING_MODEL) return "embedding";
  if (model === e.OPENAI_ECONOMY_MODEL) return "economy";
  if (model === e.OPENAI_PROTECTED_MODEL) return "protected";
  return tier;
}

export function costForUsage(tier: ModelTier, usage: AiUsage, provider: "MOCK" | "OPENAI", model?: string): number {
  const rates = priceTableFromEnv(env())[provider === "OPENAI" ? pricingTierFor(tier, model) : tier];
  // OpenAI output_tokens already include reasoning tokens.
  return computeCostUsd(usage, rates, { reasoningIncludedInOutput: provider === "OPENAI" });
}

/** Persist one AiRequest row. Never throws (returns "" when the database is unavailable). */
export async function persistAiRequest(input: PersistAiRequestInput): Promise<string> {
  const e = input.envelope;
  try {
    const row = await prisma.aiRequest.create({
      data: {
        sessionId: e.sessionId,
        userId: e.userId || null,
        courseId: e.courseId || null,
        assignmentId: e.assignmentId,
        questionId: e.questionId,
        mode: e.mode,
        task: input.task,
        provider: input.provider,
        model: input.model,
        providerRequestId: input.providerRequestId,
        traceId: e.traceId,
        promptTemplateId: e.promptTemplateId,
        promptVersion: e.promptVersion,
        policyVersion: e.policyVersion,
        assignmentVersion: e.assignmentVersion,
        questionVersion: e.questionVersion,
        researchCondition: e.researchCondition,
        status: input.status,
        errorClass: dbErrorClass(input.errorClass),
        errorMessage: input.errorMessage?.slice(0, 500) ?? null,
        latencyMs: Math.round(input.latencyMs),
        firstTokenMs: input.firstTokenMs ?? null,
        inputTokens: input.usage.inputTokens,
        cachedTokens: input.usage.cachedTokens,
        outputTokens: input.usage.outputTokens,
        reasoningTokens: input.usage.reasoningTokens,
        costUsd: costForUsage(input.tier, input.usage, input.provider, input.model),
        appVersion: env().APP_VERSION,
        retrievedResourceIds: e.retrievedResources.map((r) => r.resourceId),
        structuredOutputValid: input.structuredOutputValid,
        retryCount: input.retryCount,
        fallbackUsed: input.fallbackUsed ?? false,
        routingReason: input.routingReason ?? null,
        completedAt: new Date(),
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("[ai-gateway] failed to persist AiRequest", err);
    return "";
  }
}

/** Mark a persisted request after downstream handling (policy block, fallback). Never throws. */
export async function updateAiRequestStatus(
  aiRequestId: string,
  status: AiRequestStatus,
  opts: { fallbackUsed?: boolean; errorMessage?: string } = {},
): Promise<void> {
  if (!aiRequestId) return;
  try {
    await prisma.aiRequest.update({
      where: { id: aiRequestId },
      data: { status, fallbackUsed: opts.fallbackUsed, errorMessage: opts.errorMessage?.slice(0, 500) },
    });
  } catch (err) {
    console.error("[ai-gateway] failed to update AiRequest", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runtime AI kill switch: env AI_KILL_SWITCH OR the admin FeatureFlag row `ai_kill_switch` (scope "env").
 * Same semantics as isAiKillSwitchOn() in src/server/domain/admin/ai.ts, re-implemented here because that module
 * imports next/* (via http.ts) and the gateway must stay worker-safe. Never throws (DB errors -> env value only).
 */
export const AI_KILL_SWITCH_FLAG_KEY = "ai_kill_switch";

export async function isKillSwitchOn(): Promise<boolean> {
  try {
    if (env().AI_KILL_SWITCH) return true;
  } catch {
    return false;
  }
  try {
    const row = await prisma.featureFlag.findUnique({
      where: { key_scopeKey: { key: AI_KILL_SWITCH_FLAG_KEY, scopeKey: "env" } },
      select: { enabled: true },
    });
    return row?.enabled === true;
  } catch {
    return false;
  }
}

export async function runAi<T = unknown>(envelope: AiRequestEnvelope, opts: RunAiOptions<T>): Promise<RunAiResult<T>> {
  const traced = envelope.traceId ? envelope : { ...envelope, traceId: randomUUID() };
  let built: ReturnType<typeof buildProviderRequest>;
  let provider: AiProvider;
  try {
    built = buildProviderRequest(traced, {
      task: opts.task,
      maxOutputTokens: opts.maxOutputTokens,
      structured: opts.schema,
      extraInstruction: opts.extraInstruction,
      signal: opts.signal,
    });
    provider = getAiProvider();
  } catch (err) {
    const pe = toProviderError(err);
    return { ok: false, errorClass: pe.errorClass, message: pe.message, aiRequestId: "" };
  }
  const { request } = built;
  const routingReason = `${traced.mode}/${opts.task} -> ${request.tier} tier; ${getModeDefinition(traced.mode).outputHandling.logging}`;

  if (await isKillSwitchOn()) {
    const id = await persistAiRequest({
      envelope: built.envelope,
      task: opts.task,
      tier: request.tier,
      provider: provider.name,
      model: request.model,
      providerRequestId: null,
      status: "FAILED",
      errorClass: "KILL_SWITCH",
      errorMessage: "AI_KILL_SWITCH is on",
      latencyMs: 0,
      usage: zeroUsage(),
      retryCount: 0,
      structuredOutputValid: null,
      routingReason,
    });
    return { ok: false, errorClass: "KILL_SWITCH", message: "AI is disabled by the administrator", aiRequestId: id };
  }

  const outcome = await executeWithRetries(provider, request, opts.schema);
  const aiRequestId = await persistAiRequest({
    envelope: built.envelope,
    task: opts.task,
    tier: request.tier,
    provider: provider.name,
    model: outcome.result?.model ?? request.model,
    providerRequestId: outcome.result?.providerRequestId ?? null,
    status: outcome.ok ? "SUCCEEDED" : "FAILED",
    errorClass: outcome.errorClass,
    errorMessage: outcome.ok ? null : outcome.message,
    latencyMs: outcome.latencyMs,
    usage: outcome.usage,
    retryCount: outcome.retryCount,
    structuredOutputValid: outcome.structuredOutputValid,
    routingReason,
  });

  if (outcome.ok && outcome.result) {
    return {
      ok: true,
      text: outcome.result.text,
      structured: outcome.structured,
      aiRequestId,
      model: outcome.result.model,
      usage: outcome.usage,
      latencyMs: outcome.latencyMs,
    };
  }
  return {
    ok: false,
    errorClass: outcome.errorClass ?? "UNKNOWN",
    message: outcome.message,
    aiRequestId,
  };
}

function errorInfo(err: AiProviderError): AiErrorInfo {
  return {
    errorClass: err.errorClass,
    message: err.message,
    retryable: err.retryable,
    userMessage: err.userMessage || STUDENT_FALLBACK_MESSAGE,
  };
}

/**
 * Streaming variant. Yields `delta` chunks, then `done` (result.aiRequestId set) or `error`.
 * Retries once on a transient error that happens before the first delta. Persists AiRequest on completion.
 */
export async function* streamAi(envelope: AiRequestEnvelope, opts: StreamAiOptions): AsyncIterable<AiStreamChunk> {
  const traced = envelope.traceId ? envelope : { ...envelope, traceId: randomUUID() };
  let built: ReturnType<typeof buildProviderRequest>;
  let provider: AiProvider;
  try {
    built = buildProviderRequest(traced, { task: opts.task, maxOutputTokens: opts.maxOutputTokens, signal: opts.signal });
    provider = getAiProvider();
  } catch (err) {
    yield { type: "error", error: errorInfo(toProviderError(err)) };
    return;
  }
  const { request } = built;
  const routingReason = `${traced.mode}/${opts.task} -> ${request.tier} tier; streamed`;
  const base = {
    envelope: built.envelope,
    task: opts.task,
    tier: request.tier,
    provider: provider.name,
    structuredOutputValid: null,
    routingReason,
  } as const;

  if (await isKillSwitchOn()) {
    const id = await persistAiRequest({
      ...base,
      model: request.model,
      providerRequestId: null,
      status: "FAILED",
      errorClass: "KILL_SWITCH",
      errorMessage: "AI_KILL_SWITCH is on",
      latencyMs: 0,
      usage: zeroUsage(),
      retryCount: 0,
    });
    const err = new AiProviderError("KILL_SWITCH", `kill switch (${id})`, false);
    yield { type: "error", error: errorInfo(err) };
    return;
  }

  const started = Date.now();
  let retryCount = 0;
  for (;;) {
    let firstTokenMs: number | null = null;
    let emitted = false;
    let failure: AiProviderError | null = null;
    try {
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === "delta") {
          if (firstTokenMs === null) firstTokenMs = Date.now() - started;
          emitted = true;
          yield chunk;
        } else if (chunk.type === "done") {
          const id = await persistAiRequest({
            ...base,
            model: chunk.result.model,
            providerRequestId: chunk.result.providerRequestId,
            status: "SUCCEEDED",
            errorClass: null,
            errorMessage: null,
            latencyMs: Date.now() - started,
            firstTokenMs,
            usage: chunk.result.usage,
            retryCount,
          });
          yield { type: "done", result: { ...chunk.result, latencyMs: Date.now() - started, aiRequestId: id } };
          return;
        } else {
          failure = new AiProviderError(chunk.error.errorClass, chunk.error.message, chunk.error.retryable);
          break;
        }
      }
      if (!failure) failure = new AiProviderError("UNKNOWN", "stream ended without completion", true);
    } catch (err) {
      failure = toProviderError(err);
    }
    if (failure.retryable && !emitted && retryCount === 0) {
      retryCount++;
      continue;
    }
    const id = await persistAiRequest({
      ...base,
      model: request.model,
      providerRequestId: null,
      status: "FAILED",
      errorClass: failure.errorClass,
      errorMessage: failure.message,
      latencyMs: Date.now() - started,
      firstTokenMs,
      usage: zeroUsage(),
      retryCount,
    });
    yield { type: "error", error: { ...errorInfo(failure), message: `${failure.message}${id ? ` (aiRequest ${id})` : ""}` } };
    return;
  }
}

/** Embeddings through the gateway (usage + cost logged with task "embedding"). Throws AiProviderError on failure. */
export async function embedTexts(
  texts: string[],
  attribution: { userId: string | null; courseId: string; traceId?: string },
): Promise<{ vectors: number[][]; model: string; aiRequestId: string }> {
  const provider = getAiProvider();
  const model = modelForTier("embedding");
  const started = Date.now();
  const traceId = attribution.traceId ?? randomUUID();
  const envelope: AiRequestEnvelope = {
    mode: "FACULTY_AUTHORING",
    task: "embedding",
    traceId,
    userId: attribution.userId ?? "",
    courseId: attribution.courseId,
    assignmentId: null,
    questionId: null,
    sessionId: null,
    researchCondition: null,
    promptTemplateId: "embedding",
    promptVersion: "embedding-v1",
    policyVersion: null,
    assignmentVersion: null,
    questionVersion: null,
    assignment: null,
    policy: null,
    workspace: null,
    latestExecution: null,
    retrievalScope: { courseId: attribution.courseId, allowedResourceIds: "NONE" },
    retrievedResources: [],
    conversation: [],
    userMessage: "",
  };
  const tokens = Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
  try {
    const vectors = await provider.embed(texts, { model, envelope: { userId: envelope.userId, courseId: attribution.courseId, traceId } });
    const id = await persistAiRequest({
      envelope,
      task: "embedding",
      tier: "embedding",
      provider: provider.name,
      model: provider.name === "MOCK" ? "mock-embedding" : model,
      providerRequestId: null,
      status: "SUCCEEDED",
      errorClass: null,
      errorMessage: null,
      latencyMs: Date.now() - started,
      usage: { inputTokens: tokens, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      retryCount: 0,
      structuredOutputValid: null,
    });
    return { vectors, model, aiRequestId: id };
  } catch (err) {
    const pe = toProviderError(err);
    await persistAiRequest({
      envelope,
      task: "embedding",
      tier: "embedding",
      provider: provider.name,
      model,
      providerRequestId: null,
      status: "FAILED",
      errorClass: pe.errorClass,
      errorMessage: pe.message,
      latencyMs: Date.now() - started,
      usage: zeroUsage(),
      retryCount: 0,
      structuredOutputValid: null,
    });
    throw pe;
  }
}

/** Exposed for tests/admin: cost of an embedding batch. */
export function embeddingCost(tokens: number): number {
  return computeEmbeddingCostUsd(tokens, priceTableFromEnv(env()).embedding);
}
