import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunJob, RunnerLanguage, TestSpec } from "@/server/runner/types";

/** VercelSandboxRunner mapping logic with the @vercel/sandbox SDK mocked (no network). */

interface RunParams {
  cmd: string;
  args: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  stdout?: Writable;
  stderr?: Writable;
}
interface FakeBehaviour {
  createError?: unknown;
  run?: (p: RunParams) => Promise<{ exitCode: number }>;
}

const state = vi.hoisted(() => ({
  behaviour: {} as FakeBehaviour,
  createParams: [] as unknown[],
  written: [] as { path: string; content: Buffer }[],
  commands: [] as RunParams[],
  stopped: 0,
}));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: vi.fn(async (params: unknown) => {
      state.createParams.push(params);
      if (state.behaviour.createError) throw state.behaviour.createError;
      return {
        name: "sbx-test",
        writeFiles: async (files: { path: string; content: Buffer }[]) => {
          state.written.push(...files);
        },
        runCommand: async (p: RunParams) => {
          state.commands.push(p);
          // The root setup step always succeeds.
          if (p.args[1]?.startsWith("sudo -n sh -c")) return { exitCode: 0 };
          return state.behaviour.run ? state.behaviour.run(p) : { exitCode: 0 };
        },
        stop: async () => {
          state.stopped += 1;
        },
      };
    }),
  },
}));

const {
  VercelSandboxRunner,
  buildRunScript,
  buildSetupScript,
  describeSandboxError,
  isSandboxTimeout,
} = await import("@/server/runner/vercel-sandbox-runner");

const LIMITS = { timeoutMs: 2000, memory: "256m", cpus: "0.5", pidsLimit: 64, outputLimitBytes: 1024 };
const ENTRY: Record<RunnerLanguage, string> = { PYTHON: "main.py", JAVASCRIPT: "main.js", SCALA: "main.scala" };
function job(language: RunnerLanguage, extra: Partial<RunJob> = {}): RunJob {
  return {
    runId: "run-1",
    language,
    files: [{ path: ENTRY[language], content: "print(1)" }],
    entryFile: ENTRY[language],
    tests: [],
    mode: "run",
    limits: LIMITS,
    ...extra,
  };
}
const write = (s: Writable | undefined, text: string) =>
  new Promise<void>((resolve) => (s ? s.write(Buffer.from(text), () => resolve()) : resolve()));

const runner = new VercelSandboxRunner();

beforeEach(() => {
  state.behaviour = {};
  state.createParams = [];
  state.written = [];
  state.commands = [];
  state.stopped = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("VercelSandboxRunner", () => {
  it("creates a locked-down sandbox, passes stdout through and always stops it", async () => {
    state.behaviour.run = async (p) => {
      await write(p.stdout, "hello\n");
      return { exitCode: 0 };
    };
    const r = await runner.run(job("PYTHON"));
    expect(r).toMatchObject({ status: "OK", stdout: "hello\n", exitCode: 0, runnerDriver: "vercel-sandbox" });
    const params = state.createParams[0] as Record<string, unknown>;
    expect(params).toMatchObject({ runtime: "python3.13", networkPolicy: "deny-all", persistent: false });
    expect(params).not.toHaveProperty("env");
    expect(state.stopped).toBe(1);
    // The same harness files as the Docker image.
    expect(state.written.map((f) => f.path)).toEqual([
      "/tmp/socra-in/bootstrap.py",
      "/tmp/socra-in/harness.py",
      "/tmp/socra-in/payload.json",
    ]);
    const run = state.commands.at(-1)!;
    expect(run.timeoutMs).toBeGreaterThan(LIMITS.timeoutMs);
    expect(run.args[1]).toContain("env -i");
  });

  it("uses node22 for JavaScript", async () => {
    await runner.run(job("JAVASCRIPT"));
    expect(state.createParams[0]).toMatchObject({ runtime: "node22" });
    expect(state.written[0]!.path).toBe("/tmp/socra-in/bootstrap.js");
  });

  it("maps a non-zero exit to RUNTIME_ERROR / COMPILE_ERROR like Docker", async () => {
    state.behaviour.run = async (p) => {
      await write(p.stderr, "Traceback...\nZeroDivisionError: division by zero\n");
      return { exitCode: 1 };
    };
    expect((await runner.run(job("PYTHON"))).status).toBe("RUNTIME_ERROR");
    state.behaviour.run = async (p) => {
      await write(p.stderr, "SyntaxError: invalid syntax\n");
      return { exitCode: 1 };
    };
    const r = await runner.run(job("PYTHON"));
    expect(r).toMatchObject({ status: "COMPILE_ERROR", errorClass: "STUDENT_COMPILE" });
  });

  it("maps a quick exit 137 to MEMORY_LIMIT (not a timeout)", async () => {
    state.behaviour.run = async () => ({ exitCode: 137 });
    expect((await runner.run(job("PYTHON"))).status).toBe("MEMORY_LIMIT");
  });

  it("aborts on the output cap and reports OUTPUT_LIMIT", async () => {
    state.behaviour.run = async (p) => {
      await write(p.stdout, "x".repeat(4096));
      await new Promise((_, reject) => {
        if (p.signal?.aborted) reject(new Error("aborted"));
        p.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return { exitCode: 0 };
    };
    const r = await runner.run(job("PYTHON"));
    expect(r).toMatchObject({ status: "OUTPUT_LIMIT", errorClass: "STUDENT_OUTPUT", truncated: true });
    expect(r.stdout.length).toBe(LIMITS.outputLimitBytes);
    expect(state.stopped).toBe(1);
  });

  it("compares tests host-side: expected values never enter the sandbox", async () => {
    const tests: TestSpec[] = [
      { id: "p1", name: "p1", visibility: "PUBLIC", weight: 1, kind: "function", entryPoint: "add", args: [2, 3], expectedReturn: 5 },
      { id: "h1", name: "h1", visibility: "HIDDEN", weight: 1, kind: "function", entryPoint: "add", args: [1, 1], expectedReturn: 98765 },
    ];
    state.behaviour.run = async (p) => {
      await write(
        p.stdout,
        JSON.stringify({
          results: [
            { id: "p1", ok: true, json: 5, stdout: "", stderr: "", exitCode: 0, durationMs: 3, status: "OK" },
            { id: "h1", ok: true, json: 2, stdout: "", stderr: "", exitCode: 0, durationMs: 3, status: "OK" },
          ],
        }),
      );
      return { exitCode: 0 };
    };
    const r = await runner.run(job("PYTHON", { mode: "tests", tests }));
    expect(r.testResults.map((t) => t.passed)).toEqual([true, false]);
    const payload = state.written.find((f) => f.path.endsWith("payload.json"))!.content.toString();
    expect(payload).not.toContain("98765");
    expect(payload).not.toContain("expectedReturn");
  });

  it("maps SDK auth / quota / credential errors to RUNNER_UNAVAILABLE without output", async () => {
    state.behaviour.createError = Object.assign(new Error("Forbidden"), { response: { status: 403 } });
    const r = await runner.run(job("PYTHON"));
    expect(r).toMatchObject({ status: "RUNNER_UNAVAILABLE", errorClass: "PLATFORM_UNAVAILABLE", stdout: "" });
    expect(r.stderr).toMatch(/credentials \(HTTP 403\)/);
    expect(state.stopped).toBe(0);

    state.behaviour.createError = Object.assign(new Error("Too many"), { response: { status: 429 } });
    expect((await runner.run(job("PYTHON"))).stderr).toMatch(/quota or rate limit/);

    const oidc = new Error("Could not get credentials from OIDC context.");
    oidc.name = "LocalOidcContextError";
    state.behaviour.createError = oidc;
    expect((await runner.run(job("PYTHON"))).stderr).toMatch(/not configured/);
  });

  it("a failure mid-run is RUNNER_UNAVAILABLE and the sandbox is still stopped", async () => {
    state.behaviour.run = async () => {
      throw Object.assign(new Error("boom"), { response: { status: 500 } });
    };
    const r = await runner.run(job("PYTHON"));
    expect(r.status).toBe("RUNNER_UNAVAILABLE");
    expect(r.stderr).toMatch(/HTTP 500/);
    expect(state.stopped).toBe(1);
  });

  it("Scala is unavailable on this driver and never creates a sandbox", async () => {
    const r = await runner.run(job("SCALA"));
    expect(r.status).toBe("RUNNER_UNAVAILABLE");
    expect(r.stderr).toBe("Scala runs are not available on this deployment.");
    expect(state.createParams).toHaveLength(0);
  });

  it("health reflects credential presence", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_TOKEN", "");
    expect((await runner.health()).available).toBe(false);
    vi.stubEnv("VERCEL_OIDC_TOKEN", "header.payload.sig");
    const h = await runner.health();
    expect(h).toMatchObject({ available: true, languages: { PYTHON: true, JAVASCRIPT: true, SCALA: false } });
  });
});

describe("vercel-sandbox pure helpers", () => {
  it("timeout classification needs both SIGKILL and an elapsed deadline", () => {
    expect(isSandboxTimeout(137, 3600, 3500)).toBe(true);
    expect(isSandboxTimeout(137, 200, 3500)).toBe(false);
    expect(isSandboxTimeout(1, 9000, 3500)).toBe(false);
  });

  it("run script drops privileges, clears env and kills the whole uid at the deadline", () => {
    const s = buildRunScript("PYTHON", 64, 3500);
    expect(s).toContain("sudo -n -u '#65534' -g '#65534' env -i");
    expect(s).toContain("ulimit -u 64");
    expect(s).toContain("sleep 3.500");
    expect(s).toContain("pkill -KILL -U 65534");
    expect(s).toContain("python3 /opt/socra/bootstrap.py");
    expect(s).toContain("< /tmp/socra-in/payload.json");
    expect(buildSetupScript("js")).toContain("chmod 0600 /tmp/socra-in/payload.json");
  });

  it("error descriptions never echo the raw SDK message", () => {
    const msg = describeSandboxError(new Error("token=abc.def.ghi leaked"));
    expect(msg).not.toContain("abc.def");
  });
});
