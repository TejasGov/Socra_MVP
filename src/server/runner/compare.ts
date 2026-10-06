import type { TestSpec } from "./types";

/** Host-side comparison. Expected values never enter the sandbox, so student code cannot see or forge them. */

type Json = unknown;

export function deepEqualJson(a: Json, b: Json, tolerance: number | null): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return tolerance === null ? a === b : Math.abs(a - b) <= tolerance;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqualJson(v, b[i], tolerance));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      deepEqualJson((a as Record<string, Json>)[k], (b as Record<string, Json>)[k], tolerance),
    );
  }
  return a === b;
}

/** stdio comparison. "exact" ignores only CRLF vs LF and trailing newlines; "normalized_whitespace" collapses runs. */
export function compareStdout(
  actual: string,
  expected: string,
  comparator: TestSpec["comparator"],
): boolean {
  const a = actual.replace(/\r\n/g, "\n");
  const e = expected.replace(/\r\n/g, "\n");
  if (comparator === "normalized_whitespace") {
    const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
    return norm(a) === norm(e);
  }
  const trimEnd = (s: string) => s.replace(/\n+$/, "");
  return trimEnd(a) === trimEnd(e);
}

export interface RawTestOutcome {
  ok: boolean;
  /** function tests: {json} | {repr} ; stdio tests: stdout string in `stdoutValue`. */
  json?: Json;
  repr?: string;
  hasJson: boolean;
  stdoutValue?: string;
  error?: string;
}

export function renderValue(v: unknown): string {
  try {
    const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Returns passed + the rendered actual/expected strings. */
export function evaluateTest(
  test: TestSpec,
  raw: RawTestOutcome,
): { passed: boolean; actual: string; expected: string; message?: string } {
  if (test.kind === "stdio") {
    const expected = test.expectedStdout ?? "";
    const actual = raw.stdoutValue ?? "";
    if (!raw.ok)
      return { passed: false, actual, expected, message: raw.error ?? "The program exited with an error." };
    return { passed: compareStdout(actual, expected, test.comparator), actual, expected };
  }
  const expected = renderValue(test.expectedReturn);
  if (!raw.ok) {
    return { passed: false, actual: "", expected, message: raw.error ?? "The function raised an error." };
  }
  if (!raw.hasJson) {
    const repr = raw.repr ?? "";
    const passed = typeof test.expectedReturn === "string" && test.expectedReturn === repr;
    return { passed, actual: repr, expected };
  }
  const tol = test.comparator === "float" ? (test.tolerance ?? 1e-6) : null;
  const passed = deepEqualJson(raw.json, test.expectedReturn, tol);
  return { passed, actual: renderValue(raw.json), expected };
}
