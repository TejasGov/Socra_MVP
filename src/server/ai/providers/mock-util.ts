import { createHash } from "node:crypto";
import type { AiRequestEnvelope, LatestExecutionContext } from "../types";

/** Shared helpers for the deterministic mock provider. */

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Deterministic PRNG (mulberry32) seeded by a hash of the inputs. */
export function seededRng(seed: string): () => number {
  let a = parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

export interface ParsedError {
  kind: "syntax" | "runtime" | "none";
  /** The error line exactly as the runtime printed it, e.g. "SyntaxError: expected ':'". */
  message: string;
  /** 1-based line in the student's file, when the error names one. */
  line: number | null;
  errorType: string | null;
}

/** Parse Python / Node / Scala error output into kind + exact message + line number. */
export function parseError(exec: LatestExecutionContext | null): ParsedError {
  if (!exec) return { kind: "none", message: "", line: null, errorType: null };
  const stderr = exec.stderr ?? "";
  if (!stderr.trim() && exec.status !== "COMPILE_ERROR" && exec.status !== "RUNTIME_ERROR") {
    return { kind: "none", message: "", line: null, errorType: null };
  }
  const lines = stderr.split("\n").map((l) => l.trimEnd());
  let line: number | null = null;
  // Python: File "main.py", line 4   (last occurrence = innermost frame in the student's file)
  for (const l of lines) {
    const m = /File "[^"]*", line (\d+)/.exec(l);
    if (m && !/<frozen|site-packages|harness/i.test(l)) line = Number(m[1]);
  }
  // Scala 3: -- [E040] Syntax Error: Main.scala:3:12 ----  or  Main.scala:3: error:
  if (line === null) {
    const m = /\.scala:(\d+)(?::\d+)?/.exec(stderr);
    if (m) line = Number(m[1]);
  }
  // Node: /tmp/main.js:7   or   at fn (main.js:7:12)
  if (line === null) {
    const m = /\.(?:js|mjs|cjs):(\d+)/.exec(stderr);
    if (m) line = Number(m[1]);
  }
  const errLine =
    [...lines].reverse().find((l) => /^\s*[\w.]*(Error|Exception)\b.*:?/.test(l) && !/^\s*at /.test(l)) ??
    lines.find((l) => /error/i.test(l)) ??
    lines.filter((l) => l.trim()).pop() ??
    "";
  const message = errLine.replace(/^-- \[E\d+\] /, "").replace(/-+$/, "").trim();
  const errorType = /([\w.]*(?:Error|Exception))/.exec(message)?.[1] ?? null;
  const syntax =
    exec.status === "COMPILE_ERROR" || /SyntaxError|IndentationError|TabError|Syntax Error|ParseError/.test(stderr);
  return { kind: syntax ? "syntax" : "runtime", message, line, errorType };
}

export type TopicKey =
  | "recursion"
  | "linked-lists"
  | "trees"
  | "lists"
  | "loops"
  | "strings"
  | "complexity"
  | "functions";

const TOPIC_PATTERNS: Array<[TopicKey, RegExp]> = [
  ["linked-lists", /linked[\s-]?list|\bnode\b|\.next\b|\bhead\b/i],
  ["trees", /\btree|\bbst\b|binary search tree|traversal|inorder|preorder|postorder|\.left\b|\.right\b/i],
  ["recursion", /recurs|base case|call[\s-]?stack|factorial|fibonacci/i],
  ["complexity", /complexity|big[\s-]?o|asymptotic|runtime analysis|o\(n/i],
  ["strings", /\bstring|palindrome|substring|character/i],
  ["lists", /\blist\b|\blists\b|\barray|index|element/i],
  ["loops", /\bloop|\bfor\b|\bwhile\b|iterat|control flow/i],
];

export function detectTopics(...texts: Array<string | null | undefined>): TopicKey[] {
  const joined = texts.filter(Boolean).join("\n");
  const found = TOPIC_PATTERNS.filter(([, re]) => re.test(joined)).map(([k]) => k);
  return found.length ? found : ["functions"];
}

export function codeLine(code: string, n: number | null): string | null {
  if (!n) return null;
  return code.split("\n")[n - 1] ?? null;
}

export function priorUserTurns(env: AiRequestEnvelope): string[] {
  return env.conversation.filter((t) => t.role === "user").map((t) => t.content);
}

export const ANSWER_SEEKING =
  /(give|show|tell|send|write|just)\s+(me\s+)?(the\s+)?(full\s+|whole\s+|complete\s+|correct\s+|final\s+)?(answer|solution|code|implementation)|write (it|the (code|function)) for me|do it for me|fix (it|this|my code) for me|just fix|full solution|complete solution|what('?s| is) the answer|hidden tests?|paste the (code|solution)/i;

export const START_HELP = /where (do|should) i (start|begin)|don'?t know (how|where) to (start|begin)|how do i (start|begin)|no idea|i'?m (lost|stuck)/i;

export const CONCEPT_QUESTION = /^(what|why|how|explain|can you explain|what's|whats)\b/i;

export function firstSentence(text: string, max = 220): string {
  const s = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  const out = m?.[1] ?? s;
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}

/** Find the student's main function name (first def/function/const fn). */
export function mainFunctionName(code: string): string | null {
  const m =
    /^\s*def\s+(\w+)\s*\(/m.exec(code) ??
    /^\s*function\s+(\w+)\s*\(/m.exec(code) ??
    /^\s*(?:const|let)\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*=>/m.exec(code);
  return m?.[1] ?? null;
}

/** Lines (1-based) that call `fn` inside its own body (recursive calls), excluding the header. */
export function recursiveCallLines(code: string, fn: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`);
  code.split("\n").forEach((l, i) => {
    if (re.test(l) && !/^\s*(def|function)\s/.test(l) && !/^\s*(const|let)\s+\w+\s*=/.test(l)) out.push(i + 1);
  });
  return out;
}

export function conditionLines(code: string): number[] {
  const out: number[] = [];
  code.split("\n").forEach((l, i) => {
    if (/^\s*(if|elif|else if|while)\b|^\s*\}?\s*else\s+if\b|^\s*if\s*\(/.test(l)) out.push(i + 1);
  });
  return out;
}

export function returnLines(code: string): number[] {
  const out: number[] = [];
  code.split("\n").forEach((l, i) => {
    if (/^\s*return\b/.test(l)) out.push(i + 1);
  });
  return out;
}
