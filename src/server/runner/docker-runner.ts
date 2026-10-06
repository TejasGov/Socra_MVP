import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { env } from "../env";
import { appendCapped, buildDockerRunArgs, containerNameFor, imageFor } from "./docker-args";
import { evaluateTest, type RawTestOutcome } from "./compare";
import { buildScalaScript, parseScalaOutput, safeId } from "./scala-job";
import type {
  CodeRunner,
  RunErrorClass,
  RunJob,
  RunResult,
  RunStatus,
  RunnerHealth,
  RunnerLanguage,
  TestResult,
} from "./types";
import { runnerUnavailable } from "./types";

/**
 * DockerRunner (TASK §13). Each job = one disposable container (`docker run --rm`) with no network, memory/cpu/pids
 * limits, read-only root, tmpfs /work and /tmp, all capabilities dropped, non-root user, and NO environment variables
 * or bind mounts from the app. Code and harness travel over stdin (JSON for Python/Node, a shell script for Scala).
 * The host enforces the wall-clock timeout (`docker kill <name>`) and the output cap, and maps exit 137 to
 * MEMORY_LIMIT. Expected values are compared on the host and are never sent into the container.
 */

const DOCKER_BIN = process.env.DOCKER_BIN || "docker";
const GRACE_MS = 1500;
const TESTS_COLLECT_CAP = 4 * 1024 * 1024;

interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputLimit: boolean;
  truncated: boolean;
  spawnError: string | null;
  durationMs: number;
}

function dockerCmd(args: string[], timeoutMs = 10_000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    const p = spawn(DOCKER_BIN, args, { windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    };
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      err += "docker command timed out";
      done(null);
    }, timeoutMs);
    p.stdout.on("data", (d: Buffer) => (out += d.toString()));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e) => {
      err += e.message;
      done(null);
    });
    p.on("close", (c) => done(c));
  });
}

/** Minimal env for the docker CLI process itself; nothing here reaches the container (no -e flags are ever used). */
function cliEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ProgramData", "TEMP", "TMP"];
  const out = { MSYS_NO_PATHCONV: "1" } as unknown as NodeJS.ProcessEnv;
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class DockerRunner implements CodeRunner {
  readonly driver = "docker";

  private images() {
    const e = env();
    return { python: e.RUNNER_IMAGE_PYTHON, javascript: e.RUNNER_IMAGE_JAVASCRIPT, scala: e.RUNNER_IMAGE_SCALA };
  }

  async health(): Promise<RunnerHealth> {
    const info = await dockerCmd(["version", "--format", "{{.Server.Version}}"], 5000);
    if (info.code !== 0) {
      return {
        driver: this.driver,
        available: false,
        languages: {},
        detail: `Docker engine not reachable: ${(info.err || "no output").trim().split("\n")[0]}`,
      };
    }
    const images = this.images();
    const languages: RunnerHealth["languages"] = {};
    for (const [lang, key] of [
      ["PYTHON", "python"],
      ["JAVASCRIPT", "javascript"],
      ["SCALA", "scala"],
    ] as const) {
      const r = await dockerCmd(["image", "inspect", "--format", "{{.Id}}", images[key]], 5000);
      languages[lang] = r.code === 0;
    }
    const missing = Object.entries(languages)
      .filter(([, ok]) => !ok)
      .map(([l]) => l);
    return {
      driver: this.driver,
      available: Object.values(languages).some(Boolean),
      languages,
      detail:
        missing.length > 0
          ? `Docker ${info.out.trim()}; images missing for ${missing.join(", ")} (run: node scripts/runner-pull.mjs)`
          : `Docker ${info.out.trim()}`,
    };
  }

  /** Spawn the container, stream stdin, enforce timeout + output cap. */
  private execContainer(
    job: RunJob,
    stdinPayload: string,
    opts: { hostTimeoutMs: number; collectCap: number },
  ): Promise<ProcResult & { containerName: string }> {
    const containerName = containerNameFor(job.runId, randomBytes(4).toString("hex"));
    const args = buildDockerRunArgs({
      containerName,
      image: imageFor(job.language, this.images()),
      limits: job.limits,
    });
    const t0 = Date.now();
    return new Promise((resolve) => {
      const stdout = { text: "", bytes: 0, truncated: false };
      const stderr = { text: "", bytes: 0, truncated: false };
      let timedOut = false;
      let outputLimit = false;
      let spawnError: string | null = null;
      let settled = false;
      const kill = () => void dockerCmd(["kill", containerName], 8000);
      const p = spawn(DOCKER_BIN, args, {
        windowsHide: true,
        // Minimal env for the docker CLI itself; nothing here reaches the container (no -e flags).
        env: cliEnv(),
      });
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, opts.hostTimeoutMs);
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          containerName,
          stdout: stdout.text,
          stderr: job.language === "SCALA" ? stripAnsi(stderr.text) : stderr.text,
          exitCode,
          timedOut,
          outputLimit,
          truncated: stdout.truncated || stderr.truncated,
          spawnError,
          durationMs: Date.now() - t0,
        });
      };
      const check = () => {
        if (!outputLimit && stdout.bytes + stderr.bytes >= opts.collectCap && (stdout.truncated || stderr.truncated)) {
          outputLimit = true;
          kill();
        }
      };
      p.stdout.on("data", (d: Buffer) => {
        appendCapped(stdout, d, opts.collectCap);
        check();
      });
      p.stderr.on("data", (d: Buffer) => {
        appendCapped(stderr, d, Math.min(opts.collectCap, 256 * 1024));
        check();
      });
      p.on("error", (e) => {
        spawnError = e.message;
        finish(null);
      });
      p.on("close", (code) => finish(code));
      p.stdin.on("error", () => undefined);
      p.stdin.end(stdinPayload);
    });
  }

  async run(job: RunJob): Promise<RunResult> {
    try {
      return job.language === "SCALA" ? await this.runScala(job) : await this.runInterpreted(job);
    } catch (err) {
      return {
        ...runnerUnavailable(job.runId, this.driver, "Runner failed unexpectedly"),
        status: "INTERNAL_ERROR",
        errorClass: "PLATFORM_ERROR",
        stderr: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
      };
    }
  }

  // ---------------------------------------------------------------------------------------------------- run mode

  private baseResult(job: RunJob, p: ProcResult): RunResult {
    return {
      runId: job.runId,
      status: "OK",
      stdout: p.stdout,
      stderr: p.stderr,
      exitCode: p.exitCode,
      durationMs: p.durationMs,
      testResults: [],
      truncated: p.truncated,
      errorClass: null,
      runnerDriver: this.driver,
    };
  }

  /** Detect docker-level failures (daemon down, image missing) so we report RUNNER_UNAVAILABLE, never fake output. */
  private platformFailure(job: RunJob, p: ProcResult): RunResult | null {
    if (p.spawnError) return runnerUnavailable(job.runId, this.driver, `Docker CLI not available: ${p.spawnError}`);
    if (!p.timedOut && !p.outputLimit && (p.exitCode === 125 || p.exitCode === 126 || p.exitCode === 127)) {
      const msg = (p.stderr || "").trim().split("\n").slice(-2).join(" ");
      if (/Unable to find image|No such image|pull access denied/i.test(msg))
        return runnerUnavailable(job.runId, this.driver, `Runner image missing for ${job.language}. Run: node scripts/runner-pull.mjs`);
      if (/Cannot connect to the Docker daemon|error during connect|pipe/i.test(msg))
        return runnerUnavailable(job.runId, this.driver, "Docker engine is not running");
      return runnerUnavailable(job.runId, this.driver, `Container could not start: ${msg.slice(0, 300)}`);
    }
    return null;
  }

  private classify(job: RunJob, p: ProcResult, r: RunResult): void {
    if (p.timedOut) {
      r.status = "TIMEOUT";
      r.errorClass = "STUDENT_TIMEOUT";
      r.exitCode = null;
    } else if (p.outputLimit) {
      r.status = "OUTPUT_LIMIT";
      r.errorClass = "STUDENT_OUTPUT";
    } else if (p.exitCode === 137) {
      r.status = "MEMORY_LIMIT";
      r.errorClass = "STUDENT_MEMORY";
    } else if (p.exitCode !== 0) {
      const compile = isCompileError(job.language, r.stderr);
      r.status = compile ? "COMPILE_ERROR" : "RUNTIME_ERROR";
      r.errorClass = compile ? "STUDENT_COMPILE" : "STUDENT_RUNTIME";
    }
  }

  private async runInterpreted(job: RunJob): Promise<RunResult> {
    const outCap = job.limits.outputLimitBytes;
    const defaultTestMs = Math.min(5000, job.limits.timeoutMs);
    if (job.mode === "run") {
      const payload = JSON.stringify({ mode: "run", entry: job.entryFile, stdin: job.stdin ?? "", files: job.files });
      const p = await this.execContainer(job, payload, {
        hostTimeoutMs: job.limits.timeoutMs + GRACE_MS,
        collectCap: outCap,
      });
      const bad = this.platformFailure(job, p);
      if (bad) return bad;
      const r = this.baseResult(job, p);
      this.classify(job, p, r);
      return r;
    }
    const tests = job.tests.map((t) => ({
      id: safeId(t.id),
      kind: t.kind,
      entryPoint: t.entryPoint,
      args: t.args ?? [],
      stdin: t.stdin ?? "",
      timeoutMs: Math.min(t.timeoutMs ?? defaultTestMs, job.limits.timeoutMs),
    }));
    const total = tests.reduce((a, t) => a + t.timeoutMs, 0);
    const payload = JSON.stringify({
      mode: "tests",
      entry: job.entryFile,
      files: job.files,
      tests,
      outCap: Math.min(outCap, 16384),
    });
    const p = await this.execContainer(job, payload, {
      hostTimeoutMs: Math.min(total, 120_000) + GRACE_MS * 2,
      collectCap: TESTS_COLLECT_CAP,
    });
    const bad = this.platformFailure(job, p);
    if (bad) return bad;
    interface Raw {
      id: string;
      ok: boolean;
      json?: unknown;
      value?: string;
      stdout?: string;
      stderr?: string;
      exitCode?: number | null;
      durationMs?: number;
      status?: RunStatus;
      error?: string;
      repr?: string;
    }
    let raws: Raw[] = [];
    try {
      raws = (JSON.parse(p.stdout) as { results: Raw[] }).results;
    } catch {
      /* container died before reporting (timeout / OOM / output limit) */
    }
    const byId = new Map(raws.map((r) => [r.id, r]));
    return this.assembleTests(job, p, (t) => {
      const raw = byId.get(safeId(t.id));
      if (!raw) return null;
      return {
        raw: {
          ok: raw.ok,
          hasJson: raw.repr === undefined,
          json: raw.json,
          repr: raw.repr,
          stdoutValue: raw.value,
          error: raw.error ?? (raw.ok ? undefined : lastLines(raw.stderr)),
        },
        stdout: raw.stdout ?? "",
        stderr: raw.stderr ?? "",
        status: raw.status ?? (raw.ok ? "OK" : "RUNTIME_ERROR"),
        durationMs: raw.durationMs ?? 0,
        exitCode: raw.exitCode ?? null,
      };
    });
  }

  // --------------------------------------------------------------------------------------------------- scala

  private async runScala(job: RunJob): Promise<RunResult> {
    const nonce = randomBytes(12).toString("hex");
    const defaultTestMs = Math.min(10_000, job.limits.timeoutMs);
    const script = buildScalaScript({
      nonce,
      files: job.files,
      mode: job.mode,
      stdin: job.stdin,
      tests: job.tests.map((t) => ({ ...t })),
      defaultTestTimeoutMs: defaultTestMs,
    });
    if (job.mode === "run") {
      const p = await this.execContainer(job, script, {
        hostTimeoutMs: job.limits.timeoutMs + GRACE_MS,
        collectCap: job.limits.outputLimitBytes,
      });
      const bad = this.platformFailure(job, p);
      if (bad) return bad;
      const r = this.baseResult(job, p);
      this.classify(job, p, r);
      return r;
    }
    const p = await this.execContainer(job, script, {
      hostTimeoutMs: job.limits.timeoutMs * 2 + GRACE_MS,
      collectCap: TESTS_COLLECT_CAP,
    });
    const bad = this.platformFailure(job, p);
    if (bad) return bad;
    const parsed = parseScalaOutput(p.stdout, nonce);
    const res = this.assembleTests(
      job,
      p,
      (t) => {
        const pt = parsed.tests.get(safeId(t.id));
        if (!pt) return null;
        return {
          raw: {
            ok: pt.ok,
            hasJson: pt.hasJson,
            json: pt.json,
            stdoutValue: pt.stdout,
            error: pt.error ?? (pt.ok ? undefined : lastLines(pt.stderr)),
          },
          stdout: pt.stdout,
          stderr: pt.stderr,
          status: pt.ok ? "OK" : pt.exitCode === 137 ? "TIMEOUT" : "RUNTIME_ERROR",
          durationMs: pt.durationMs,
          exitCode: pt.exitCode,
        };
      },
      parsed.compileError,
    );
    return res;
  }

  // ------------------------------------------------------------------------------------------ shared assembly

  private assembleTests(
    job: RunJob,
    p: ProcResult,
    get: (t: RunJob["tests"][number]) => {
      raw: RawTestOutcome;
      stdout: string;
      stderr: string;
      status: RunStatus;
      durationMs: number;
      exitCode: number | null;
    } | null,
    compileError: string | null = null,
  ): RunResult {
    const results: TestResult[] = [];
    const publicOut: string[] = [];
    const publicErr: string[] = [];
    let truncated = p.truncated;
    let syntaxProblem = compileError !== null;
    let worst: RunStatus = "OK";
    for (const t of job.tests) {
      const g = get(t);
      let status: RunStatus;
      let evaluated: ReturnType<typeof evaluateTest>;
      if (!g) {
        status = p.timedOut ? "TIMEOUT" : p.outputLimit ? "OUTPUT_LIMIT" : p.exitCode === 137 ? "MEMORY_LIMIT" : "RUNTIME_ERROR";
        evaluated = {
          passed: false,
          actual: "",
          expected: "",
          message:
            status === "TIMEOUT"
              ? "The time limit was exceeded."
              : status === "MEMORY_LIMIT"
                ? "The memory limit was exceeded."
                : status === "OUTPUT_LIMIT"
                  ? "The output limit was exceeded."
                  : (compileError ?? "The test did not produce a result."),
        };
        if (t.kind === "function") evaluated.expected = safeRender(t.expectedReturn);
        else evaluated.expected = t.expectedStdout ?? "";
      } else {
        status = g.status;
        evaluated = evaluateTest(t, g.raw);
        if (status === "OK" && !evaluated.passed && !g.raw.ok) status = "RUNTIME_ERROR";
        if (g.stdout.length >= 8192 || g.stderr.length >= 8192) truncated = true;
        if (/SyntaxError|IndentationError/.test(g.stderr) && !g.raw.ok) syntaxProblem = true;
        if (t.visibility === "PUBLIC") {
          if (g.stdout) publicOut.push(job.tests.length > 1 ? `[${t.name}]\n${g.stdout}` : g.stdout);
          if (g.stderr) publicErr.push(job.tests.length > 1 ? `[${t.name}]\n${g.stderr}` : g.stderr);
        }
      }
      if (status === "TIMEOUT" || status === "MEMORY_LIMIT" || status === "OUTPUT_LIMIT") {
        if (worst === "OK") worst = status;
      }
      const result: TestResult = {
        testId: t.id,
        name: t.name,
        visibility: t.visibility,
        passed: evaluated.passed,
        weight: t.weight,
        status,
        durationMs: g?.durationMs,
        actual: evaluated.actual,
        expected: evaluated.expected,
      };
      result.message = evaluated.passed
        ? undefined
        : (evaluated.message ?? (t.failureHint ? t.failureHint : "The output did not match the expected result."));
      if (!evaluated.passed && evaluated.message && t.failureHint) result.message = `${evaluated.message}\n${t.failureHint}`;
      results.push(result);
    }
    let status: RunStatus = worst;
    let errorClass: RunErrorClass | null =
      worst === "TIMEOUT"
        ? "STUDENT_TIMEOUT"
        : worst === "MEMORY_LIMIT"
          ? "STUDENT_MEMORY"
          : worst === "OUTPUT_LIMIT"
            ? "STUDENT_OUTPUT"
            : null;
    if (syntaxProblem && results.every((r) => !r.passed)) {
      status = "COMPILE_ERROR";
      errorClass = "STUDENT_COMPILE";
    }
    return {
      runId: job.runId,
      status,
      // Top-level streams carry PUBLIC test output only; hidden/diagnostic output never leaves the per-test records.
      stdout: publicOut.join("\n"),
      stderr: compileError !== null ? stripAnsi(compileError) : publicErr.join("\n"),
      exitCode: p.exitCode,
      durationMs: p.durationMs,
      testResults: results,
      truncated,
      errorClass,
      runnerDriver: this.driver,
    };
  }
}

const stripAnsi = (s: string) => s.replace(/[[0-9;]*m/g, "");

function safeRender(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function lastLines(s: string | undefined, n = 6): string | undefined {
  if (!s) return undefined;
  return s.trim().split("\n").slice(-n).join("\n");
}

export function isCompileError(language: RunnerLanguage, stderr: string): boolean {
  if (language === "PYTHON") return /(SyntaxError|IndentationError|TabError)/.test(stderr);
  if (language === "JAVASCRIPT") return /SyntaxError/.test(stderr);
  return /\[error\]|error:|Compilation failed/i.test(stderr);
}

