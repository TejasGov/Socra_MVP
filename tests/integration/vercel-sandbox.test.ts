import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultRunLimits, setCodeRunnerForTests } from "@/server/runner";
import { runGradingTests } from "@/server/domain/grading/runner";
import { VercelSandboxRunner } from "@/server/runner/vercel-sandbox-runner";
import { toStudentRunResult, type RunJob, type RunnerLanguage, type TestSpec } from "@/server/runner/types";
import { resetEnvCache } from "@/server/env";

/**
 * Real executions in Vercel Sandbox microVMs (network + credentials required, costs sandbox minutes).
 * Skipped unless RUN_SANDBOX_TESTS=1. Locally: `vercel env pull` (VERCEL_OIDC_TOKEN in .env.local), then
 *   RUN_SANDBOX_TESTS=1 npx vitest run --project integration tests/integration/vercel-sandbox.test.ts
 */
const enabled = process.env.RUN_SANDBOX_TESTS === "1";
const runner = new VercelSandboxRunner();
const timings: string[] = [];

const ENTRY: Record<RunnerLanguage, string> = { PYTHON: "main.py", JAVASCRIPT: "main.js", SCALA: "main.scala" };
function job(language: RunnerLanguage, code: string, extra: Partial<RunJob> = {}): RunJob {
  return {
    runId: `sbx-${language}-${Math.random().toString(36).slice(2, 8)}`,
    language,
    files: [{ path: ENTRY[language], content: code }],
    entryFile: ENTRY[language],
    tests: [],
    mode: "run",
    limits: defaultRunLimits(language),
    ...extra,
  };
}
const fnTest = (id: string, visibility: TestSpec["visibility"], args: unknown[], expectedReturn: unknown): TestSpec => ({
  id,
  name: id,
  visibility,
  weight: 1,
  kind: "function",
  entryPoint: "add",
  args,
  expectedReturn,
});

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  timings.push(`${label}: ${Date.now() - t0}ms wall`);
  return r;
}

describe.skipIf(!enabled)("vercel-sandbox runner (live)", () => {
  const prevDriver = process.env.CODE_RUNNER_DRIVER;
  beforeAll(() => {
    process.env.CODE_RUNNER_DRIVER = "vercel-sandbox";
    resetEnvCache();
    setCodeRunnerForTests(undefined);
  });
  afterAll(() => {
    if (prevDriver === undefined) Reflect.deleteProperty(process.env, "CODE_RUNNER_DRIVER");
    else process.env.CODE_RUNNER_DRIVER = prevDriver;
    resetEnvCache();
    setCodeRunnerForTests(undefined);
    console.log(`[vercel-sandbox timings]\n  ${timings.join("\n  ")}`);
  });

  it("health reports credentials", async () => {
    const h = await runner.health();
    expect(h.available).toBe(true);
    expect(h.languages.SCALA).toBe(false);
  });

  it("PYTHON hello world", { timeout: 60_000 }, async () => {
    const r = await timed("PYTHON hello", () => runner.run(job("PYTHON", 'print("hello from python")')));
    expect(r.status).toBe("OK");
    expect(r.stdout.trim()).toBe("hello from python");
    expect(r.exitCode).toBe(0);
    expect(r.runnerDriver).toBe("vercel-sandbox");
  });

  it("PYTHON function tests: passing + failing, hidden details stripped", { timeout: 90_000 }, async () => {
    const tests = [fnTest("p1", "PUBLIC", [2, 3], 5), fnTest("h1", "HIDDEN", [10, 20], 30)];
    const good = await timed("PYTHON tests pass", () =>
      runner.run(job("PYTHON", "def add(a, b):\n    return a + b\n", { mode: "tests", tests })),
    );
    expect(good.status).toBe("OK");
    expect(good.testResults.map((t) => t.passed)).toEqual([true, true]);
    const bad = await timed("PYTHON tests fail", () =>
      runner.run(job("PYTHON", "def add(a, b):\n    return a - b\n", { mode: "tests", tests })),
    );
    expect(bad.testResults.map((t) => t.passed)).toEqual([false, false]);
    const student = toStudentRunResult(bad);
    expect(student.testResults).toHaveLength(1);
    expect(JSON.stringify(student)).not.toContain("h1");
    expect(student.testResults[0]!.actual).toBe("-1");
    expect(student.testResults[0]!.expected).toBe("5");
  });

  it("PYTHON timeout -> TIMEOUT, and no network", { timeout: 90_000 }, async () => {
    const r = await timed("PYTHON timeout(1500ms)", () =>
      runner.run(job("PYTHON", "while True: pass", { limits: { ...defaultRunLimits("PYTHON"), timeoutMs: 1500 } })),
    );
    expect(r.status).toBe("TIMEOUT");
    expect(r.errorClass).toBe("STUDENT_TIMEOUT");
    // A background child holding stdout must not keep the run alive past the program's own exit.
    const bg = await timed("PYTHON orphan child", () =>
      runner.run(job("PYTHON", ["import subprocess", "subprocess.Popen(['sleep', '60'])", "print('done')"].join("\n"))),
    );
    expect(bg.status).toBe("OK");
    expect(bg.stdout.trim()).toBe("done");
    const net = await runner.run(
      job(
        "PYTHON",
        "import os, socket\nprint('UID', os.getuid())\nprint('ENV', sorted(k for k in os.environ if not k.startswith('PYTHON')))\n" +
          "try:\n  socket.create_connection(('1.1.1.1', 53), 2)\n  print('NET')\nexcept Exception:\n  print('NONET')",
      ),
    );
    expect(net.stdout).toContain("NONET");
    expect(net.stdout).toContain("UID 65534");
    expect(net.stdout).not.toMatch(/VERCEL|OIDC|TOKEN|SECRET|DATABASE/);
  });

  it("JAVASCRIPT hello world", { timeout: 60_000 }, async () => {
    const r = await timed("JAVASCRIPT hello", () => runner.run(job("JAVASCRIPT", 'console.log("hello from js")')));
    expect(r.status).toBe("OK");
    expect(r.stdout.trim()).toBe("hello from js");
  });

  it("JAVASCRIPT timeout -> TIMEOUT", { timeout: 60_000 }, async () => {
    const r = await timed("JAVASCRIPT timeout(1500ms)", () =>
      runner.run(job("JAVASCRIPT", "while(true){}", { limits: { ...defaultRunLimits("JAVASCRIPT"), timeoutMs: 1500 } })),
    );
    expect(r.status).toBe("TIMEOUT");
  });

  it("output cap -> OUTPUT_LIMIT", { timeout: 60_000 }, async () => {
    const r = await timed("PYTHON output flood", () =>
      runner.run(job("PYTHON", "while True: print('x' * 1000)")),
    );
    expect(r.status).toBe("OUTPUT_LIMIT");
    expect(r.truncated).toBe(true);
  });

  it("SCALA is unavailable on this driver", async () => {
    const r = await runner.run(job("SCALA", "@main def hi = println(1)"));
    expect(r.status).toBe("RUNNER_UNAVAILABLE");
    expect(r.stderr).toMatch(/Scala runs are not available/);
  });

  it("grading (kind GRADING, hidden tests) goes through executeRun -> vercel-sandbox", { timeout: 90_000 }, async () => {
    const r = await timed("GRADING via executeRun", () =>
      runGradingTests({
        runId: `sbx-grade-${Date.now()}`,
        language: "PYTHON",
        code: "def add(a, b):\n    return a + b\n",
        tests: [fnTest("p1", "PUBLIC", [1, 2], 3), fnTest("h1", "HIDDEN", [5, 5], 10)],
      }),
    );
    expect(r.runnerDriver).toBe("vercel-sandbox");
    expect(r.status).toBe("OK");
    expect(r.testResults.map((t) => [t.visibility, t.passed])).toEqual([
      ["PUBLIC", true],
      ["HIDDEN", true],
    ]);
  });
});
