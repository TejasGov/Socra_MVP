import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { DockerRunner } from "@/server/runner/docker-runner";
import { defaultRunLimits } from "@/server/runner";
import {
  toStudentRunResult,
  type RunJob,
  type RunnerLanguage,
  type TestSpec,
} from "@/server/runner/types";
import { env } from "@/server/env";

/** Real container executions through DockerRunner (no queue). Requires Docker + `node scripts/runner-pull.mjs`. */
const runner = new DockerRunner();
const available: Record<string, boolean> = {};
const timings: string[] = [];

function hasImage(tag: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  available.PYTHON = hasImage(env().RUNNER_IMAGE_PYTHON);
  available.JAVASCRIPT = hasImage(env().RUNNER_IMAGE_JAVASCRIPT);
  available.SCALA = hasImage(env().RUNNER_IMAGE_SCALA);
});

const ENTRY: Record<RunnerLanguage, string> = {
  PYTHON: "main.py",
  JAVASCRIPT: "main.js",
  SCALA: "main.scala",
};
function job(language: RunnerLanguage, code: string, extra: Partial<RunJob> = {}): RunJob {
  return {
    runId: `it-${language}-${Math.random().toString(36).slice(2, 8)}`,
    language,
    files: [{ path: ENTRY[language], content: code }],
    entryFile: ENTRY[language],
    tests: [],
    mode: "run",
    limits: defaultRunLimits(language),
    ...extra,
  };
}
const fnTest = (
  id: string,
  visibility: TestSpec["visibility"],
  args: unknown[],
  expectedReturn: unknown,
): TestSpec => ({
  id,
  name: id,
  visibility,
  weight: 1,
  kind: "function",
  entryPoint: "add",
  args,
  expectedReturn,
});

describe.each([
  [
    "PYTHON",
    'print("hello from python")',
    "hello from python",
    "def add(a, b):\n    return a + b\n",
    "def add(a, b):\n    return a - b\n",
  ],
  [
    "JAVASCRIPT",
    'console.log("hello from js")',
    "hello from js",
    "function add(a, b) { return a + b; }\n",
    "function add(a, b) { return a - b; }\n",
  ],
] as const)("%s sandbox", (language, hello, helloOut, goodCode, badCode) => {
  it("runs hello world", async (ctx) => {
    if (!available[language]) return ctx.skip();
    const r = await runner.run(job(language, hello));
    timings.push(`${language} run: ${r.durationMs}ms`);
    expect(r.status).toBe("OK");
    expect(r.stdout.trim()).toBe(helloOut);
    expect(r.exitCode).toBe(0);
  });

  it("passes a correct solution and fails a wrong one (hidden details stripped)", async (ctx) => {
    if (!available[language]) return ctx.skip();
    const tests = [fnTest("p1", "PUBLIC", [2, 3], 5), fnTest("h1", "HIDDEN", [10, 20], 30)];
    const good = await runner.run(job(language, goodCode, { mode: "tests", tests }));
    timings.push(`${language} tests(2): ${good.durationMs}ms`);
    expect(good.testResults.map((t) => t.passed)).toEqual([true, true]);
    const bad = await runner.run(job(language, badCode, { mode: "tests", tests }));
    expect(bad.testResults.map((t) => t.passed)).toEqual([false, false]);
    const student = toStudentRunResult(bad);
    expect(student.testResults).toHaveLength(1);
    expect(JSON.stringify(student)).not.toContain("h1");
    expect(student.testResults[0]!.actual).toBe("-1");
    expect(student.testResults[0]!.expected).toBe("5");
  });

  it("stdio tests compare stdout", async (ctx) => {
    if (!available[language]) return ctx.skip();
    const code =
      language === "PYTHON"
        ? "print(int(input()) * 2)"
        : "console.log(Number(require('fs').readFileSync(0,'utf8')) * 2)";
    const t: TestSpec = {
      id: "s1",
      name: "double",
      visibility: "PUBLIC",
      weight: 1,
      kind: "stdio",
      stdin: "21\n",
      expectedStdout: "42",
    };
    const r = await runner.run(job(language, code, { mode: "tests", tests: [t] }));
    expect(r.testResults[0]!.passed).toBe(true);
  });

  it("enforces the timeout and has no network", async (ctx) => {
    if (!available[language]) return ctx.skip();
    const loop = language === "PYTHON" ? "while True: pass" : "while(true){}";
    const r = await runner.run(
      job(language, loop, { limits: { ...defaultRunLimits(language), timeoutMs: 1500 } }),
    );
    expect(r.status).toBe("TIMEOUT");
    expect(r.errorClass).toBe("STUDENT_TIMEOUT");
    const net =
      language === "PYTHON"
        ? "import socket\ntry:\n  socket.create_connection(('1.1.1.1', 53), 2)\n  print('NET')\nexcept Exception:\n  print('NONET')"
        : "require('net').connect(53,'1.1.1.1').on('connect',()=>{console.log('NET');process.exit()}).on('error',()=>console.log('NONET'))";
    const n = await runner.run(job(language, net));
    expect(n.stdout).toContain("NONET");
  });

  it("caps output", async (ctx) => {
    if (!available[language]) return ctx.skip();
    const code =
      language === "PYTHON"
        ? "while True: print('x'*1000)"
        : "for(;;) console.log('x'.repeat(1000))";
    const r = await runner.run(
      job(language, code, { limits: { ...defaultRunLimits(language), outputLimitBytes: 4096 } }),
    );
    expect(r.status).toBe("OUTPUT_LIMIT");
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(4096);
  });
});

describe("Scala sandbox (optional: skipped when the image is absent)", () => {
  it("runs hello world and a function test", async (ctx) => {
    if (!available.SCALA) return ctx.skip();
    const r = await runner.run(job("SCALA", '@main def hi = println("hello from scala")'));
    timings.push(`SCALA run: ${r.durationMs}ms`);
    expect(r.status).toBe("OK");
    expect(r.stdout.trim()).toBe("hello from scala");
    const tests = [fnTest("p1", "PUBLIC", [2, 3], 5), fnTest("h1", "HIDDEN", [1, 1], 3)];
    const t = await runner.run(
      job("SCALA", "def add(a: Int, b: Int): Int = a + b\n", { mode: "tests", tests }),
    );
    timings.push(`SCALA tests(2): ${t.durationMs}ms`);
    expect(t.testResults.map((x) => x.passed)).toEqual([true, false]);
  }, 120_000);
});

describe("memory limit", () => {
  it("maps OOM to MEMORY_LIMIT", async (ctx) => {
    if (!available.PYTHON) return ctx.skip();
    const r = await runner.run(job("PYTHON", "x = bytearray(1024*1024*1024)\nprint(len(x))"));
    expect(r.status).toBe("MEMORY_LIMIT");
    console.info("[runner timings]", timings.join("; "));
  });
});
