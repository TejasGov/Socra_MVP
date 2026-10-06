import "server-only";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai";
import type {
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { env } from "../../env";
import {
  AiProviderError,
  type AiProvider,
  type AiResult,
  type AiStreamChunk,
  type AiUsage,
  type EmbedOptions,
  type ProviderRequest,
} from "../types";

/**
 * OpenAiProvider — official `openai` SDK (v7), Responses API only.
 *   - `client.responses.create` (non-streaming) and `client.responses.stream` (streaming)
 *   - `store: false` (no provider-side conversation retention)
 *   - structured output via `text.format = { type: "json_schema", strict: true }`
 *   - usage incl. cached input tokens and reasoning-token COUNT (never reasoning content)
 *   - embeddings via `client.embeddings.create`
 * Constructed lazily; never instantiated in mock mode. The key never leaves the server.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "OPENAI" as const;
  private client: OpenAI | undefined;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const e = env();
    if (!e.OPENAI_API_KEY) {
      throw new AiProviderError("NOT_CONFIGURED", "OPENAI_API_KEY is not set", false);
    }
    this.client = new OpenAI({
      apiKey: e.OPENAI_API_KEY,
      baseURL: e.OPENAI_BASE_URL,
      organization: e.OPENAI_ORG_ID,
      timeout: e.OPENAI_TIMEOUT_MS,
      // The gateway owns retry policy (one retry for transient errors).
      maxRetries: 0,
    });
    return this.client;
  }

  private buildParams(req: ProviderRequest): ResponseCreateParamsNonStreaming {
    const instructions = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const input: ResponseInputItem[] = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ type: "message" as const, role: m.role as "user" | "assistant" | "developer", content: m.content }));
    const params: ResponseCreateParamsNonStreaming = {
      model: req.model,
      instructions: instructions || undefined,
      input,
      store: false,
      max_output_tokens: req.maxOutputTokens,
      // Stable per-mode cache key keeps the shared prefix (system + assignment context) cache-friendly.
      prompt_cache_key: `${req.envelope.promptTemplateId}:${req.envelope.assignmentId ?? req.envelope.courseId}`,
    };
    if (req.temperature !== undefined) params.temperature = req.temperature;
    if (req.reasoningEffort) params.reasoning = { effort: req.reasoningEffort };
    if (req.structuredOutput) {
      params.text = {
        format: {
          type: "json_schema",
          name: req.structuredOutput.name,
          schema: req.structuredOutput.schema,
          strict: req.structuredOutput.strict ?? true,
        },
      };
    }
    return params;
  }

  async generate(req: ProviderRequest): Promise<AiResult> {
    const started = Date.now();
    try {
      const response = await this.getClient().responses.create(this.buildParams(req), {
        signal: req.signal,
        timeout: req.timeoutMs,
      });
      return toResult(response, req, Date.now() - started);
    } catch (err) {
      throw normalizeOpenAiError(err);
    }
  }

  async *stream(req: ProviderRequest): AsyncIterable<AiStreamChunk> {
    const started = Date.now();
    let stream;
    try {
      stream = this.getClient().responses.stream({ ...this.buildParams(req), stream: true as const }, {
        signal: req.signal,
        timeout: req.timeoutMs,
      });
    } catch (err) {
      const e = normalizeOpenAiError(err);
      yield { type: "error", error: e };
      return;
    }
    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "delta", text: event.delta };
        }
      }
      const final = await stream.finalResponse();
      yield { type: "done", result: toResult(final, req, Date.now() - started) };
    } catch (err) {
      yield { type: "error", error: normalizeOpenAiError(err) };
    }
  }

  async embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    if (texts.length === 0) return [];
    try {
      const res = await this.getClient().embeddings.create(
        { model: opts.model, input: texts, encoding_format: "float" },
        { signal: opts.signal },
      );
      return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    } catch (err) {
      throw normalizeOpenAiError(err);
    }
  }
}

function toResult(response: OpenAiResponse, req: ProviderRequest, latencyMs: number): AiResult {
  const usage: AiUsage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
  const incomplete = response.incomplete_details?.reason;
  const finishReason: AiResult["finishReason"] =
    incomplete === "max_output_tokens"
      ? "length"
      : incomplete === "content_filter"
        ? "content_filter"
        : response.status === "completed" || response.status === undefined
          ? "stop"
          : "other";
  let structured: unknown;
  if (req.structuredOutput) {
    try {
      structured = JSON.parse(response.output_text);
    } catch {
      structured = undefined; // gateway reports SCHEMA_VALIDATION / INVALID_OUTPUT
    }
  }
  return {
    text: response.output_text,
    structured,
    usage,
    model: response.model ?? req.model,
    provider: "OPENAI",
    providerRequestId: response.id ?? null,
    latencyMs,
    finishReason,
  };
}

/** Map SDK errors to the gateway error classes. Never leaks provider internals to students. */
export function normalizeOpenAiError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err;
  if (err instanceof APIUserAbortError) return new AiProviderError("TIMEOUT", "request aborted", false);
  if (err instanceof APIConnectionTimeoutError) return new AiProviderError("TIMEOUT", "provider timeout", true);
  if (err instanceof APIConnectionError) {
    return new AiProviderError("PROVIDER_UNAVAILABLE", "provider connection error", true);
  }
  if (err instanceof RateLimitError) return new AiProviderError("RATE_LIMITED", "provider rate limited", true);
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return new AiProviderError("AUTH", "provider authentication failed", false);
  }
  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    const msg = err.message ?? "bad request";
    if (/content|safety|policy/i.test(msg)) return new AiProviderError("CONTENT_FILTER", msg, false);
    return new AiProviderError("INVALID_REQUEST", msg, false);
  }
  if (err instanceof InternalServerError) {
    return new AiProviderError("PROVIDER_UNAVAILABLE", `provider error ${err.status}`, true);
  }
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    return new AiProviderError(status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN", err.message, status >= 500);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AiProviderError("UNKNOWN", message, false);
}
