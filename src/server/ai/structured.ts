import { z } from "zod";
import type { StructuredOutputSpec } from "./types";

/**
 * zod 4 -> JSON Schema for OpenAI structured outputs (`text.format.type = "json_schema"`, strict).
 * Strict mode needs closed objects with every property listed in `required`; we enforce that recursively.
 */
export function toStructuredOutputSpec(name: string, schema: z.ZodType): StructuredOutputSpec {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return { name: name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), schema: strictify(json), strict: true };
}

function strictify(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object") return node as Record<string, unknown>;
  if (Array.isArray(node)) return node.map(strictify) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = v && typeof v === "object" ? strictify(v) : v;
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties as Record<string, unknown>);
    out.additionalProperties = false;
  }
  return out;
}

/** Extract a JSON value from model text: whole text, a ```json fence, or the outermost {...}. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export type StructuredParse<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate provider output against the zod schema. Prefers the provider's parsed object, falls back to text. */
export function parseStructured<T>(schema: z.ZodType<T>, structured: unknown, text: string): StructuredParse<T> {
  const raw = structured !== undefined ? structured : extractJson(text);
  if (raw === undefined) return { ok: false, error: "output is not valid JSON" };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
}
