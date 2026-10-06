import type { SeedTest } from "./types";

export function fnTest(
  id: string,
  name: string,
  visibility: "PUBLIC" | "HIDDEN",
  weight: number,
  entryPoint: string,
  args: unknown[],
  expectedReturn: unknown,
  failureHint?: string,
): SeedTest {
  return {
    id,
    name,
    visibility,
    weight,
    kind: "function",
    entryPoint,
    args,
    expectedReturn,
    comparator: "exact",
    ...(failureHint ? { failureHint } : {}),
  };
}

export function ioTest(
  id: string,
  name: string,
  visibility: "PUBLIC" | "HIDDEN",
  weight: number,
  stdin: string,
  expectedStdout: string,
  failureHint?: string,
): SeedTest {
  return {
    id,
    name,
    visibility,
    weight,
    kind: "stdio",
    stdin,
    expectedStdout,
    comparator: "normalized_whitespace",
    timeoutMs: 3000,
    ...(failureHint ? { failureHint } : {}),
  };
}

export function pyRecursionTrace(fn: string, call: string, recLine: string, recLineNo = 4): string {
  return [
    "Traceback (most recent call last):",
    `  File "main.py", line 9, in <module>`,
    `    print(${call})`,
    `  File "main.py", line ${recLineNo}, in ${fn}`,
    `    ${recLine}`,
    `  File "main.py", line ${recLineNo}, in ${fn}`,
    `    ${recLine}`,
    `  [Previous line repeated 996 more times]`,
    "RecursionError: maximum recursion depth exceeded",
  ].join("\n");
}

export const TIMEOUT_TEXT =
  "Execution timed out after 5000 ms. Check for a loop that never finishes.";
