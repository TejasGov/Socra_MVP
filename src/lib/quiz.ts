/**
 * Quiz answer-key conventions shared by the copilot mapping, the faculty form, grading and review.
 * Pure module: no server imports, safe for client bundles. It never decides who may see a key.
 *
 * QuestionVersion storage (matches prisma/seed/data/cse115.ts, "Quiz 2: Tracing function calls"):
 *   MULTIPLE_CHOICE  choices = [{ id, text }], answerKey = { correct: "<choice id>", explanation? }
 *   SHORT_ANSWER     choices = null,           answerKey = { accepted: ["6", ...], normalize, explanation? }
 *                    (code-trace "what does this print" questions are SHORT_ANSWER too)
 *   ESSAY            choices = null,           answerKey = { keyPoints: [...], explanation? } (graded by a person)
 */

export interface QuizChoice {
  id: string;
  text: string;
}

/** "trim": surrounding/internal whitespace only (seed default). "loose": also case, quotes, trailing period, spacing around punctuation. */
export type NormalizeMode = "exact" | "trim" | "loose";

/** Separator the copilot uses to pack several accepted answers into one strict-mode string. */
export const ACCEPTED_SEPARATOR = "||";

export function splitAccepted(text: string): string[] {
  return text
    .split(/\|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeAnswer(value: string, mode: NormalizeMode = "trim"): string {
  if (mode === "exact") return value.trim();
  let s = value.replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");
  if (mode === "loose") {
    s = s.toLowerCase();
    s = s.replace(/\.$/, "").trim();
    s = s.replace(/^(["'`])(.*)\1$/, "$2").trim();
    s = s.replace(/\.$/, "").trim();
    s = s.replace(/\s*([,[\](){}:])\s*/g, "$1");
  }
  return s;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Choice ids a, b, c, ... (the seed convention). */
export function choiceId(index: number): string {
  return String.fromCharCode(97 + (index % 26));
}

/** Stored choices may be [{ id, text }] or legacy plain strings; both map to { id, text }. */
export function parseStoredChoices(raw: unknown): QuizChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizChoice[] = [];
  raw.forEach((c, i) => {
    if (typeof c === "string") out.push({ id: c, text: c });
    else if (isObj(c)) out.push({ id: String(c.id ?? choiceId(i)), text: String(c.text ?? c.label ?? "") });
  });
  return out;
}

export interface ParsedAnswerKey {
  correct: string | null;
  accepted: string[];
  keyPoints: string[];
  normalize: NormalizeMode;
  explanation: string;
}

export function parseAnswerKey(raw: unknown): ParsedAnswerKey {
  const o = isObj(raw) ? raw : {};
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const correct =
    o.correct !== undefined && o.correct !== null
      ? String(o.correct)
      : typeof raw === "string"
        ? raw
        : null;
  const normalize =
    o.normalize === "exact" || o.normalize === "loose" || o.normalize === "trim"
      ? o.normalize
      : "trim";
  return {
    correct,
    accepted: strings(o.accepted),
    keyPoints: strings(o.keyPoints),
    normalize,
    explanation: typeof o.explanation === "string" ? o.explanation : "",
  };
}

export type QuizQuestionType = "CODING" | "SHORT_ANSWER" | "ESSAY" | "MULTIPLE_CHOICE";

/** Build the stored answerKey for a non-coding question (undefined when there is nothing to store). */
export function buildAnswerKey(args: {
  type: QuizQuestionType;
  correctChoice?: string;
  accepted?: string[];
  explanation?: string;
  normalize?: NormalizeMode;
}): Record<string, unknown> | undefined {
  const explanation = args.explanation?.trim() || undefined;
  const accepted = (args.accepted ?? []).map((a) => a.trim()).filter(Boolean);
  if (args.type === "MULTIPLE_CHOICE") {
    if (!args.correctChoice) return explanation ? { explanation } : undefined;
    return { correct: args.correctChoice, ...(explanation ? { explanation } : {}) };
  }
  if (args.type === "SHORT_ANSWER") {
    if (accepted.length === 0) return explanation ? { explanation } : undefined;
    return { accepted, normalize: args.normalize ?? "loose", ...(explanation ? { explanation } : {}) };
  }
  if (args.type === "ESSAY") {
    if (accepted.length === 0 && !explanation) return undefined;
    return { ...(accepted.length ? { keyPoints: accepted } : {}), ...(explanation ? { explanation } : {}) };
  }
  return undefined;
}

/**
 * Deterministic grading against the stored key. Returns null when the question is not auto-gradable
 * (coding, essay, or no usable key), so the caller leaves it for a person.
 */
export function gradeKeyedAnswer(
  type: string,
  answerKey: unknown,
  content: string,
): { correct: boolean } | null {
  if (answerKey === null || answerKey === undefined) return null;
  const key = parseAnswerKey(answerKey);
  if (type === "MULTIPLE_CHOICE") {
    if (key.correct === null) return null;
    return { correct: key.correct.trim().toLowerCase() === content.trim().toLowerCase() };
  }
  if (type === "SHORT_ANSWER") {
    if (key.accepted.length === 0) return null;
    const given = normalizeAnswer(content, key.normalize);
    if (given === "") return { correct: false };
    return { correct: key.accepted.some((a) => normalizeAnswer(a, key.normalize) === given) };
  }
  return null;
}
