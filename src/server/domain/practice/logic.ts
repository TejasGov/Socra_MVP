/**
 * Pure practice logic: answer normalization/checking, difficulty adaptation, item picking (TASK §15).
 * No I/O and no server-only imports so it is unit-testable.
 */

// ---------------------------------------------------------------------------
// Answer checking
// ---------------------------------------------------------------------------

export interface PracticeChoice {
  id: string;
  text: string;
  correct?: boolean;
}

/** Normalize free text for comparison: lowercase, collapse whitespace, strip wrapping quotes and trailing punctuation. */
export function normalizeText(input: string): string {
  let s = (input ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  s = s.replace(/^["'`]+|["'`]+$/g, "").trim();
  s = s.replace(/[.;,!?]+$/g, "").trim();
  return s;
}

function asNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Equal after normalization, or numerically equal ("3.0" == "3"). */
export function textMatches(response: string, accepted: string): boolean {
  const a = normalizeText(response);
  const b = normalizeText(accepted);
  if (a === b) return true;
  const na = asNumber(a);
  const nb = asNumber(b);
  return na !== null && nb !== null && Math.abs(na - nb) < 1e-9;
}

/** Normalize program output for code-tracing comparison: CRLF, trailing spaces per line, trailing blank lines. */
export function normalizeOutput(input: string): string {
  return (input ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Accept `choices` stored as string[] or [{id?, text|label, correct?}]. */
export function parseChoices(raw: unknown): PracticeChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => {
    const letter = String.fromCharCode(65 + i);
    if (typeof c === "string") return { id: letter, text: c };
    const o = (c ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? o.label ?? "");
    return {
      id: typeof o.id === "string" && o.id ? o.id : letter,
      text,
      ...(typeof o.correct === "boolean" ? { correct: o.correct } : {}),
    };
  });
}

/** Resolve a student's response to a choice index (by id, letter, 1-based number, or text). */
export function resolveChoice(choices: PracticeChoice[], response: string): number {
  const r = (response ?? "").trim();
  if (!r) return -1;
  const byId = choices.findIndex((c) => c.id.toLowerCase() === r.toLowerCase());
  if (byId >= 0) return byId;
  const letter = /^\(?([A-Za-z])\)?[.)]?$/.exec(r);
  if (letter) {
    const idx = letter[1]!.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) return idx;
  }
  return choices.findIndex((c) => textMatches(r, c.text));
}

export function correctChoiceIndexes(choices: PracticeChoice[], answer: string | null): number[] {
  const flagged = choices.map((c, i) => (c.correct ? i : -1)).filter((i) => i >= 0);
  if (flagged.length) return flagged;
  if (answer) {
    const idx = resolveChoice(choices, answer);
    if (idx >= 0) return [idx];
  }
  return [];
}

export function acceptedAnswers(item: { answer: string | null; rubric?: unknown }): string[] {
  const out: string[] = [];
  if (item.answer) out.push(...item.answer.split("||").map((s) => s.trim()).filter(Boolean));
  const r = item.rubric as { acceptedAnswers?: unknown } | null | undefined;
  if (r && Array.isArray(r.acceptedAnswers)) {
    for (const a of r.acceptedAnswers) if (typeof a === "string" && a.trim()) out.push(a.trim());
  }
  return out;
}

export interface CheckableItem {
  type: "CODING" | "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "TRACE" | "EXPLAIN";
  answer: string | null;
  choices?: unknown;
  rubric?: unknown;
}

export interface CheckResult {
  /** null = cannot be checked deterministically (free response). */
  correct: boolean | null;
  method: "AUTO" | "NONE";
}

export function checkAnswer(item: CheckableItem, response: string): CheckResult {
  const resp = response ?? "";
  switch (item.type) {
    case "MULTIPLE_CHOICE": {
      const choices = parseChoices(item.choices);
      const correct = correctChoiceIndexes(choices, item.answer);
      if (!correct.length) return { correct: null, method: "NONE" };
      const picked = resolveChoice(choices, resp);
      return { correct: picked >= 0 && correct.includes(picked), method: "AUTO" };
    }
    case "SHORT_ANSWER": {
      const accepted = acceptedAnswers(item);
      if (!accepted.length) return { correct: null, method: "NONE" };
      return { correct: accepted.some((a) => textMatches(resp, a)), method: "AUTO" };
    }
    case "TRACE": {
      const accepted = acceptedAnswers(item);
      if (!accepted.length) return { correct: null, method: "NONE" };
      const got = normalizeOutput(resp);
      return {
        correct: accepted.some((a) => normalizeOutput(a) === got || textMatches(got, normalizeOutput(a))),
        method: "AUTO",
      };
    }
    default:
      return { correct: null, method: "NONE" };
  }
}

// ---------------------------------------------------------------------------
// Adaptation (simple, interpretable; no ML)
// ---------------------------------------------------------------------------

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;
export const START_DIFFICULTY = 2;

export interface AttemptResult {
  correct: boolean;
  difficulty: number;
}

export interface Adaptation {
  difficulty: number;
  /** True after two consecutive wrong answers: serve an easier, scaffolded variant. */
  scaffold: boolean;
  changed: "UP" | "DOWN" | "NONE";
}

const clamp = (n: number) => Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, n));

/**
 * `results` are answered attempts of the session, oldest first, `correct` = graded correct (ungraded ones excluded).
 * Two consecutive correct at the current difficulty -> +1. Two consecutive wrong at the current difficulty -> -1 + scaffold.
 * Requiring both results at the CURRENT difficulty makes the streak reset automatically after every change.
 */
export function adaptDifficulty(current: number, results: AttemptResult[]): Adaptation {
  const cur = clamp(current);
  const last2 = results.slice(-2);
  if (last2.length === 2 && last2.every((r) => r.difficulty === cur)) {
    if (last2.every((r) => r.correct)) {
      const next = clamp(cur + 1);
      return { difficulty: next, scaffold: false, changed: next > cur ? "UP" : "NONE" };
    }
    if (last2.every((r) => !r.correct)) {
      const next = clamp(cur - 1);
      return { difficulty: next, scaffold: true, changed: next < cur ? "DOWN" : "NONE" };
    }
  }
  return { difficulty: cur, scaffold: false, changed: "NONE" };
}

/** Whether the next item should be a scaffolded variant: the last two graded answers were both wrong. */
export function shouldScaffold(results: AttemptResult[]): boolean {
  const last2 = results.slice(-2);
  return last2.length === 2 && last2.every((r) => !r.correct);
}

/** Starting difficulty (2-3): a learner already DEVELOPING / CONSISTENTLY_DEMONSTRATED on the topic starts at 3. */
export function startingDifficulty(
  topicState: "NEEDS_REINFORCEMENT" | "DEVELOPING" | "CONSISTENTLY_DEMONSTRATED" | null | undefined,
): number {
  return topicState === "DEVELOPING" || topicState === "CONSISTENTLY_DEMONSTRATED" ? 3 : START_DIFFICULTY;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  difficulty: number;
}

/** Small deterministic hash for tie-breaking (stable per seed, varied between serves). */
export function seededOrder(id: string, seed: string): number {
  let h = 2166136261;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Pick the candidate closest to `target` difficulty that is not in `recentItemIds` (last 10 attempts).
 * Returns null when nothing qualifies within `maxGap` (so the caller can fall to the next tier).
 * `scaffold` biases toward the easier side on ties.
 */
export function pickCandidate<T extends Candidate>(
  candidates: T[],
  opts: {
    target: number;
    recentItemIds: ReadonlySet<string>;
    maxGap?: number;
    seed?: string;
    scaffold?: boolean;
    allowRecent?: boolean;
  },
): T | null {
  const maxGap = opts.maxGap ?? 1;
  const pool = candidates.filter(
    (c) => (opts.allowRecent || !opts.recentItemIds.has(c.id)) && Math.abs(c.difficulty - opts.target) <= maxGap,
  );
  if (!pool.length) return null;
  const seed = opts.seed ?? "";
  return [...pool].sort((a, b) => {
    const da = Math.abs(a.difficulty - opts.target);
    const db = Math.abs(b.difficulty - opts.target);
    if (da !== db) return da - db;
    if (opts.scaffold && a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
    return seededOrder(a.id, seed) - seededOrder(b.id, seed);
  })[0]!;
}

/**
 * Topic choice: an explicit topic wins; otherwise rotate through the student's NEEDS_REINFORCEMENT topics;
 * otherwise null (caller falls back to any course topic).
 */
export function chooseTopic(opts: {
  sessionTopicId: string | null;
  reinforcementTopicIds: string[];
  servedCount: number;
}): string | null {
  if (opts.sessionTopicId) return opts.sessionTopicId;
  const list = opts.reinforcementTopicIds;
  if (!list.length) return null;
  return list[opts.servedCount % list.length]!;
}
