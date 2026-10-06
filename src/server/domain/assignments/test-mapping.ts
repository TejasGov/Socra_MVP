import { createHash } from "node:crypto";
import type { TestSpec, TestVisibility } from "@/server/runner/types";
import type { TestInput } from "./schema";

/**
 * TestCase row <-> runner TestSpec.
 *
 * Storage convention (documented in docs/ASSUMPTIONS.md):
 *   TestCase.input    = { kind: "function" | "stdio", entryPoint?, args?, stdin? }
 *   TestCase.expected = { returns?, stdout? }
 *   TestCase.harness  = { comparator?, tolerance? } | null
 * The reader also tolerates the flat TestSpec key names (expectedReturn, expectedStdout) so other agents' seed data
 * works either way.
 */

export interface TestCaseRow {
  id: string;
  name: string;
  visibility: TestVisibility;
  weight: number;
  input: unknown;
  expected: unknown;
  harness: unknown;
  timeoutMs: number | null;
  failureHint: string | null;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function testCaseToSpec(row: TestCaseRow, defaultEntryPoint?: string | null): TestSpec {
  const input = obj(row.input);
  const expected = obj(row.expected);
  const harness = obj(row.harness);
  const kind: "function" | "stdio" =
    input.kind === "stdio" ||
    (input.kind !== "function" && input.stdin !== undefined && input.args === undefined)
      ? "stdio"
      : "function";
  const spec: TestSpec = {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    weight: row.weight,
    kind,
  };
  if (kind === "function") {
    spec.entryPoint =
      (typeof input.entryPoint === "string" ? input.entryPoint : undefined) ??
      defaultEntryPoint ??
      undefined;
    spec.args = Array.isArray(input.args) ? input.args : [];
    if ("returns" in expected) spec.expectedReturn = expected.returns;
    else if ("expectedReturn" in expected) spec.expectedReturn = expected.expectedReturn;
  } else {
    if (typeof input.stdin === "string") spec.stdin = input.stdin;
    const out = expected.stdout ?? expected.expectedStdout;
    if (typeof out === "string") spec.expectedStdout = out;
  }
  const comparator = harness.comparator;
  if (comparator === "exact" || comparator === "float" || comparator === "normalized_whitespace") {
    spec.comparator = comparator;
  }
  if (typeof harness.tolerance === "number") spec.tolerance = harness.tolerance;
  if (row.timeoutMs) spec.timeoutMs = row.timeoutMs;
  if (row.failureHint) spec.failureHint = row.failureHint;
  return spec;
}

/** Authoring input -> TestCase column values. */
export function testInputToRow(t: TestInput): {
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  harness: Record<string, unknown> | null;
} {
  const input: Record<string, unknown> = { kind: t.kind };
  const expected: Record<string, unknown> = {};
  if (t.kind === "function") {
    if (t.entryPoint) input.entryPoint = t.entryPoint;
    input.args = t.args ?? [];
    if (t.expectedReturn !== undefined) expected.returns = t.expectedReturn;
  } else {
    input.stdin = t.stdin ?? "";
    expected.stdout = t.expectedStdout ?? "";
  }
  const harness: Record<string, unknown> = {};
  if (t.comparator) harness.comparator = t.comparator;
  if (t.tolerance !== undefined) harness.tolerance = t.tolerance;
  return { input, expected, harness: Object.keys(harness).length ? harness : null };
}

/** TestCase row -> authoring input (faculty edit form only; includes hidden tests). */
export function rowToTestInput(row: TestCaseRow, defaultEntryPoint?: string | null): TestInput {
  const spec = testCaseToSpec(row, defaultEntryPoint);
  return {
    id: row.id,
    name: spec.name,
    visibility: spec.visibility,
    weight: spec.weight,
    kind: spec.kind,
    entryPoint: spec.entryPoint,
    args: spec.args,
    expectedReturn: spec.expectedReturn,
    stdin: spec.stdin,
    expectedStdout: spec.expectedStdout,
    comparator: spec.comparator,
    tolerance: spec.tolerance,
    timeoutMs: spec.timeoutMs,
    failureHint: spec.failureHint,
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Stable JSON hash (sorted keys) for snapshots. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
