import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PolicyOutcome as DbPolicyOutcome } from "@/generated/prisma/enums";
import { prisma, type DbOrTx } from "../db";
import type { AiMode } from "./types";

/**
 * Output policy check for PROTECTED_ASSESSMENT replies (TASK §11 "output policy-check hook; log policy decisions").
 *
 * Rule-based (checker "rules-v1"); not a guarantee — defense in depth on top of the prompt policy:
 *   1. hidden_test_leak     reply mentions hidden-test inputs/expected values or names (fetched server-side here,
 *                           never put into model context)
 *   2. reference_overlap    a code block covers most of the reference solution's token 3-grams
 *   3. target_function      a code block contains a complete definition of the target function (entry point)
 *   4. large_code_block     very long code blocks in protected mode are redacted
 * Mechanical syntax fixes (a block that only changes a few characters on lines the student already wrote) are ALLOWED.
 *
 * Outcomes: ALLOW | REDACT | BLOCK_AND_REGENERATE | ESCALATE. Persisted as PolicyDecision
 * (DB enum: ALLOW | REVISE | BLOCK | ESCALATE; REDACT -> REVISE, BLOCK_AND_REGENERATE -> BLOCK).
 */

export const POLICY_CHECKER_VERSION = "rules-v1";

export type PolicyCheckOutcome = "ALLOW" | "REDACT" | "BLOCK_AND_REGENERATE" | "ESCALATE";

export interface HiddenTestMaterial {
  name: string;
  /** JSON-ish values from TestCase.input/expected (args, stdin, returns, stdout). */
  inputs: unknown[];
  expected: unknown[];
}

export interface PolicyCheckContext {
  hiddenTests: HiddenTestMaterial[];
  referenceSolution: string | null;
  /** Target function name (QuestionVersion.entryPoint). */
  entryPoint: string | null;
  /** Student's current code (mechanical-fix detection, and values already visible to the student). */
  studentCode: string;
  /** Text the student can already see (prompt, starter code, public tests): values found here are not leaks. */
  publicCorpus: string;
}

export interface PolicyCheckItem {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PolicyCheckResult {
  outcome: PolicyCheckOutcome;
  checks: PolicyCheckItem[];
  reasons: string[];
  /** Present when outcome is REDACT. */
  redactedReply?: string;
}

// ---------------------------------------------------------------------------
// Pure checks
// ---------------------------------------------------------------------------

const TRIVIAL = new Set(["true", "false", "none", "null", "undefined", "[]", "{}", '""', "''", "nil"]);

function literalForms(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (typeof v === "number" || typeof v === "boolean") return [String(v)];
  if (Array.isArray(v)) {
    const json = JSON.stringify(v);
    const py = json.replace(/,/g, ", ");
    return [json, py];
  }
  if (typeof v === "object") return [JSON.stringify(v)];
  return [];
}

/** Values distinctive enough that seeing them in a reply indicates a leak. */
function distinctive(value: string, publicCorpusNorm: string): boolean {
  const s = value.trim();
  if (s.length < 3) return false;
  if (TRIVIAL.has(s.toLowerCase())) return false;
  if (/^-?\d+$/.test(s) && Math.abs(Number(s)) < 100) return false;
  return !publicCorpusNorm.includes(normalizeWs(s));
}

const normalizeWs = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function checkHiddenTestLeak(reply: string, ctx: PolicyCheckContext): PolicyCheckItem {
  const replyNorm = normalizeWs(reply);
  const corpus = normalizeWs(`${ctx.publicCorpus}\n${ctx.studentCode}`);
  for (const t of ctx.hiddenTests) {
    if (t.name.length >= 6 && /[_\s-]/.test(t.name) && reply.toLowerCase().includes(t.name.toLowerCase()) && !corpus.includes(normalizeWs(t.name))) {
      return { check: "hidden_test_leak", passed: false, detail: "reply names a hidden test" };
    }
    const inputs = t.inputs.flatMap(literalForms).filter((s) => distinctive(s, corpus));
    const expected = t.expected.flatMap(literalForms).filter((s) => distinctive(s, corpus));
    const inputHit = inputs.some((s) => replyNorm.includes(normalizeWs(s)));
    const expectedHit = expected.some((s) => replyNorm.includes(normalizeWs(s)));
    const wholeArgs = t.inputs
      .filter((v) => Array.isArray(v) && (v as unknown[]).length > 0)
      .map((v) => normalizeWs(JSON.stringify(v)))
      .some((s) => s.length >= 5 && replyNorm.includes(s) && !corpus.includes(s));
    // A long, non-public input literal (e.g. 987654321) is itself identifying, even without the expected value.
    const strongInputHit = inputs.some((s) => s.replace(/\W/g, "").length >= 6 && replyNorm.includes(normalizeWs(s)));
    if ((inputHit && expectedHit) || wholeArgs || strongInputHit) {
      return { check: "hidden_test_leak", passed: false, detail: "reply contains hidden-test input/expected values" };
    }
  }
  return { check: "hidden_test_leak", passed: true, detail: `${ctx.hiddenTests.length} hidden tests compared` };
}

export interface CodeBlock {
  code: string;
  start: number;
  end: number;
}

/** Fenced code blocks (```...```). */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```[\w+-]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) blocks.push({ code: m[1] ?? "", start: m.index, end: m.index + m[0].length });
  return blocks;
}

const KEYWORDS = new Set(
  "def return if elif else for while in range len and or not is None True False function const let var val object class match case new null true false this yield lambda import from print println console log".split(
    " ",
  ),
);

export function codeTokens(code: string, normalizeIdentifiers = false): string[] {
  const raw = code.replace(/#.*$|\/\/.*$/gm, "").match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|=>|->|&&|\|\||[^\s\w]/g) ?? [];
  return normalizeIdentifiers ? raw.map((t) => (/^[A-Za-z_]\w*$/.test(t) && !KEYWORDS.has(t) ? "ID" : t)) : raw;
}

function grams(tokens: string[], n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) s.add(tokens.slice(i, i + n).join(" "));
  return s;
}

/**
 * Share of the reference solution's NEW content (n-grams the student has not already written) that the block covers.
 * Returns null when the reference adds too little beyond the student's code to judge.
 */
export function referenceCoverage(block: string, reference: string, studentCode: string): number | null {
  let best: number | null = null;
  for (const [n, norm] of [
    [3, false],
    [4, true],
  ] as const) {
    const ref = grams(codeTokens(reference, norm), n);
    const stu = grams(codeTokens(studentCode, norm), n);
    const blk = grams(codeTokens(block, norm), n);
    const novel = [...ref].filter((g) => !stu.has(g));
    if (novel.length < 5) continue;
    const covered = novel.filter((g) => blk.has(g)).length / novel.length;
    best = best === null ? covered : Math.max(best, covered);
  }
  return best;
}

function levenshtein(a: string, b: string, cap = 8): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** True when every non-empty line of the block is (nearly) a line the student already wrote: a mechanical fix. */
export function isMechanicalFix(block: string, studentCode: string): boolean {
  const studentLines = studentCode
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || studentLines.length === 0) return false;
  return lines.every((l) => studentLines.some((s) => s === l || levenshtein(s, l, 4) <= 3));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A complete definition of the target function: header + at least two non-empty body lines. */
export function definesTargetFunction(block: string, entryPoint: string | null): boolean {
  if (!entryPoint) return false;
  const n = escapeRe(entryPoint);
  const header = new RegExp(
    `(^|\\n)\\s*(def\\s+${n}\\s*[(\\[]|function\\s+${n}\\s*\\(|(const|let|var)\\s+${n}\\s*=\\s*(async\\s*)?(\\(|function)|${n}\\s*\\([^)]*\\)\\s*\\{)`,
  );
  const m = header.exec(block);
  if (!m) return false;
  const after = block.slice(m.index + m[0].length).split("\n").slice(1);
  return after.filter((l) => l.trim() && !/^\s*[})\]]\s*$/.test(l)).length >= 2;
}

export function checkProtectedOutput(reply: string, ctx: PolicyCheckContext): PolicyCheckResult {
  const checks: PolicyCheckItem[] = [];
  const reasons: string[] = [];
  let outcome: PolicyCheckOutcome = "ALLOW";
  const escalate = (o: PolicyCheckOutcome) => {
    const rank: Record<PolicyCheckOutcome, number> = { ALLOW: 0, REDACT: 1, BLOCK_AND_REGENERATE: 2, ESCALATE: 3 };
    if (rank[o] > rank[outcome]) outcome = o;
  };

  const leak = checkHiddenTestLeak(reply, ctx);
  checks.push(leak);
  if (!leak.passed) {
    reasons.push(leak.detail);
    escalate("BLOCK_AND_REGENERATE");
  }

  const toRedact: CodeBlock[] = [];
  for (const block of extractCodeBlocks(reply)) {
    const nonEmpty = block.code.split("\n").filter((l) => l.trim()).length;
    if (isMechanicalFix(block.code, ctx.studentCode)) {
      checks.push({ check: "mechanical_fix", passed: true, detail: `${nonEmpty}-line block only edits the student's own lines` });
      continue;
    }
    if (definesTargetFunction(block.code, ctx.entryPoint)) {
      checks.push({ check: "target_function", passed: false, detail: `complete definition of ${ctx.entryPoint}` });
      reasons.push(`code block defines the target function ${ctx.entryPoint}`);
      escalate("BLOCK_AND_REGENERATE");
      continue;
    }
    if (ctx.referenceSolution && nonEmpty >= 3) {
      const cov = referenceCoverage(block.code, ctx.referenceSolution, ctx.studentCode);
      if (cov !== null && cov >= 0.6) {
        checks.push({ check: "reference_overlap", passed: false, detail: `covers ${(cov * 100).toFixed(0)}% of the reference solution` });
        reasons.push("code block closely matches the reference solution");
        escalate("BLOCK_AND_REGENERATE");
        continue;
      }
      if (cov !== null && cov >= 0.35 && nonEmpty >= 5) {
        checks.push({ check: "reference_overlap", passed: false, detail: `partial overlap ${(cov * 100).toFixed(0)}%` });
        reasons.push("code block partially reproduces the reference solution");
        toRedact.push(block);
        escalate("REDACT");
        continue;
      }
      checks.push({ check: "reference_overlap", passed: true, detail: cov === null ? "not comparable" : `overlap ${(cov * 100).toFixed(0)}%` });
    }
    if (nonEmpty > 15) {
      checks.push({ check: "large_code_block", passed: false, detail: `${nonEmpty} lines` });
      reasons.push("code block too long for protected mode");
      toRedact.push(block);
      escalate("REDACT");
    }
  }

  const result: PolicyCheckResult = { outcome, checks, reasons };
  if ((outcome as PolicyCheckOutcome) === "REDACT") {
    let redacted = reply;
    for (const b of [...toRedact].sort((a, z) => z.start - a.start)) {
      redacted =
        redacted.slice(0, b.start) +
        "(Code removed: during an open assessment Socra can't show this much solution code. Try writing the next line yourself and run it.)" +
        redacted.slice(b.end);
    }
    result.redactedReply = redacted;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Server-side material + persistence
// ---------------------------------------------------------------------------

function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Fetch hidden/diagnostic test material and the reference solution for a question. SERVER-ONLY: the result is used
 * for comparison inside this module and is never placed in AI context or returned to clients.
 */
export async function loadPolicyMaterial(
  questionId: string | null,
  db: DbOrTx = prisma,
): Promise<{ hiddenTests: HiddenTestMaterial[]; referenceSolution: string | null; entryPoint: string | null }> {
  if (!questionId) return { hiddenTests: [], referenceSolution: null, entryPoint: null };
  const q = await db.question.findUnique({
    where: { id: questionId },
    select: {
      currentVersion: {
        select: {
          referenceSolution: true,
          entryPoint: true,
          testCases: {
            where: { visibility: { in: ["HIDDEN", "DIAGNOSTIC"] } },
            select: { name: true, input: true, expected: true },
          },
        },
      },
    },
  });
  const v = q?.currentVersion;
  if (!v) return { hiddenTests: [], referenceSolution: null, entryPoint: null };
  return {
    referenceSolution: v.referenceSolution,
    entryPoint: v.entryPoint,
    hiddenTests: v.testCases.map((t) => {
      const input = (t.input ?? {}) as Record<string, unknown>;
      const expected = (t.expected ?? {}) as Record<string, unknown>;
      const args = asArray(input.args);
      return {
        name: t.name,
        inputs: [...(args.length ? [args] : []), ...args, ...asArray(input.stdin)],
        expected: [...asArray(expected.returns), ...asArray(expected.stdout)],
      };
    }),
  };
}

export function toDbOutcome(o: PolicyCheckOutcome): DbPolicyOutcome {
  if (o === "REDACT") return "REVISE";
  if (o === "BLOCK_AND_REGENERATE") return "BLOCK";
  return o;
}

export async function persistPolicyDecision(
  input: {
    sessionId: string | null;
    aiRequestId: string | null;
    messageId?: string | null;
    mode: AiMode;
    policyVersion: string;
    checker?: string;
    outcome: PolicyCheckOutcome;
    checks: PolicyCheckItem[];
    reasons: string[];
    interventionLevel?: number | null;
  },
  db: DbOrTx = prisma,
): Promise<string | null> {
  try {
    const row = await db.policyDecision.create({
      data: {
        sessionId: input.sessionId,
        aiRequestId: input.aiRequestId || null,
        messageId: input.messageId ?? null,
        mode: input.mode,
        policyVersion: input.policyVersion,
        checker: input.checker ?? POLICY_CHECKER_VERSION,
        outcome: toDbOutcome(input.outcome),
        checks: [...input.checks, { check: "outcome", passed: input.outcome === "ALLOW", detail: input.outcome }] as unknown as Prisma.InputJsonValue,
        reasons: input.reasons,
        interventionLevel: input.interventionLevel ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("[policy-check] failed to persist PolicyDecision", err);
    return null;
  }
}
