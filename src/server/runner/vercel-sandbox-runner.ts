import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import { appendCapped } from "./docker-args";
import { DockerRunner, type ProcResult } from "./docker-runner";
import {
  runnerUnavailable,
  type RunJob,
  type RunResult,
  type RunnerHealth,
  type RunnerLanguage,
} from "./types";

/**
 * VercelSandboxRunner — CODE_RUNNER_DRIVER=vercel-sandbox. For serverless hosting (Vercel) where Docker is unavailable.
 *
 * Each job = one fresh, single-use Vercel Sandbox (Firecracker microVM) that is stopped in a `finally`:
 *   Sandbox.create({ runtime, networkPolicy: "deny-all", persistent: false, resources: { vcpus: 1 } })
 *   -> writeFiles(bootstrap + harness from docker/runner/, payload JSON)
 *   -> setup (sudo): /opt/socra (root-owned, read-only for the student), /work (owned by uid 65534)
 *   -> run as uid/gid 65534 (no sudo), with an EMPTY environment (env -i): `<interp> /opt/socra/bootstrap.* < payload`
 *   -> stop()
 *
 * It reuses DockerRunner end to end except for the transport (execContainer): the same bootstrap/harness files, the
 * same JSON payload (no expected values), the same exit-status classification, and the same host-side comparison
 * (compare.ts) and test assembly. Results are therefore identical in shape and meaning to the Docker driver.
 *
 * Limits: wall-clock timeout via an in-VM watchdog that SIGKILLs every uid-65534 process at the deadline (exit 137 ->
 * TIMEOUT), backed by the SDK's per-command `timeoutMs` and a host-side abort;
 * output cap enforced host-side while streaming (the command is aborted once exceeded); `ulimit -u` (pids) and
 * `ulimit -f` inside the VM. Memory is bounded by the VM (2 GB per vCPU), not by limits.memory; an OOM kill still
 * maps to MEMORY_LIMIT (exit 137 before the deadline).
 *
 * Scala is not offered: Vercel Sandbox runtimes are node22/24/26 and python3.13 only (no JVM), and the VM has no
 * network to download one. SCALA jobs return RUNNER_UNAVAILABLE.
 *
 * Auth: the SDK resolves credentials itself. On Vercel it uses the deployment's OIDC token (request header
 * x-vercel-oidc-token or VERCEL_OIDC_TOKEN); locally, VERCEL_OIDC_TOKEN from `vercel env pull` (.env.local). The
 * token carries the team (owner_id) and project (project_id), so no extra ids are needed. Outside Vercel an access
 * token can be used instead: VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID. None of these reach the sandbox.
 */

export const SANDBOX_DRIVER = "vercel-sandbox";

/** Vercel Sandbox runtime per language (see RUNTIMES in @vercel/sandbox/dist/constants.d.ts). */
export const SANDBOX_RUNTIME: Partial<Record<RunnerLanguage, string>> = {
  PYTHON: "python3.13",
  JAVASCRIPT: "node22",
};

/** Budget for create + writeFiles + setup on top of the command's own timeout (cold start measured at ~0.3-1s). */
const SETUP_BUDGET_MS = 30_000;
/** Host-side abort fires this long after the in-VM timeout should have killed the command. */
const HOST_ABORT_SLACK_MS = 5_000;
/** The SDK's per-command timeout sits between the in-VM watchdog and the host abort. */
const SDK_TIMEOUT_SLACK_MS = 2_000;
const IN_DIR = "/tmp/socra-in";
const SANDBOX_UID = 65534;

interface HarnessFiles {
  bootstrap: string;
  harness: string;
  ext: "py" | "js";
}

const harnessCache = new Map<string, HarnessFiles>();

/** The exact files baked into the Docker images (docker/runner/), read once. Traced into the Vercel bundle via next.config. */
export function loadHarness(language: "PYTHON" | "JAVASCRIPT", root = process.cwd()): HarnessFiles {
  const cached = harnessCache.get(language);
  if (cached) return cached;
  const ext = language === "PYTHON" ? "py" : "js";
  const dir = path.join(root, "docker", "runner");
  const files: HarnessFiles = {
    bootstrap: readFileSync(path.join(dir, `bootstrap.${ext}`), "utf8"),
    harness: readFileSync(path.join(dir, `harness.${ext}`), "utf8"),
    ext,
  };
  harnessCache.set(language, files);
  return files;
}

/** Root-only setup: harness under /opt/socra (read-only to the student), private /work for uid 65534. */
export function buildSetupScript(ext: "py" | "js"): string {
  return [
    `sudo -n sh -c 'set -e; mkdir -p /opt/socra /work;`,
    `install -m 0644 ${IN_DIR}/bootstrap.${ext} ${IN_DIR}/harness.${ext} /opt/socra/;`,
    `chmod 0755 /opt/socra; chown ${SANDBOX_UID}:${SANDBOX_UID} /work; chmod 0700 /work'`,
    // The payload stays readable only by the setup user; the student process receives it on stdin.
    `&& chmod 0600 ${IN_DIR}/payload.json`,
  ].join(" ");
}

/**
 * Run the bootstrap as uid/gid 65534 with an empty environment (env -i) and the payload on stdin (shell redirect,
 * opened by the setup user). Mirrors the Docker image ENTRYPOINT/ENV.
 */
export function buildRunScript(language: "PYTHON" | "JAVASCRIPT", pidsLimit: number, timeoutMs: number): string {
  const interp = language === "PYTHON" ? "python3" : "node";
  const ext = language === "PYTHON" ? "py" : "js";
  const pids = Math.max(8, Math.floor(pidsLimit));
  const secs = (Math.max(100, Math.floor(timeoutMs)) / 1000).toFixed(3);
  const envVars =
    language === "PYTHON"
      ? "PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONHASHSEED=0 "
      : "";
  const killAll = `sudo -n pkill -KILL -U ${SANDBOX_UID}`;
  return [
    `sudo -n -u '#${SANDBOX_UID}' -g '#${SANDBOX_UID}' env -i PATH="$PATH" HOME=/work LANG=C.UTF-8 ${envVars}` +
      `sh -c 'ulimit -u ${pids}; ulimit -f 65536; cd /work && exec ${interp} /opt/socra/bootstrap.${ext}' ` +
      `< ${IN_DIR}/payload.json &`,
    `p=$!`,
    // Watchdog: SIGKILL every process of the sandbox uid at the deadline (the student's children too, which a
    // plain kill of the sudo wrapper would orphan). sudo then exits 137, which the host maps to TIMEOUT.
    `( sleep ${secs}; ${killAll} ) >/dev/null 2>&1 &`,
    `w=$!`,
    `wait $p; rc=$?`,
    `kill $w >/dev/null 2>&1`,
    // Reap leftover background processes so they cannot hold the output streams open.
    `${killAll} >/dev/null 2>&1`,
    `exit $rc`,
  ].join("\n");
}

function errStatus(err: unknown): number | null {
  const r = (err as { response?: { status?: unknown } } | null)?.response;
  return typeof r?.status === "number" ? r.status : null;
}

/** Map an SDK/transport failure to an honest, student-safe RUNNER_UNAVAILABLE detail. Never includes tokens. */
export function describeSandboxError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  const status = errStatus(err);
  if (
    /OidcContextError|OidcTokenError/.test(name) ||
    /Could not get credentials|OIDC|Missing credentials/i.test(msg)
  ) {
    return "Code execution is not configured on this deployment (no Vercel Sandbox credentials).";
  }
  if (status === 401 || status === 403) {
    return `The code execution sandbox rejected this deployment's credentials (HTTP ${status}). Your work is saved; try again later.`;
  }
  if (status === 402 || status === 429) {
    return `The code execution sandbox quota or rate limit was reached (HTTP ${status}). Your work is saved; try again later.`;
  }
  if (status !== null) return `The code execution sandbox is unavailable (HTTP ${status}). Your work is saved; try again shortly.`;
  if (name === "AbortError" || name === "TimeoutError") {
    return "The code execution sandbox did not respond in time. Your work is saved; try again shortly.";
  }
  return "The code execution sandbox is unavailable. Your work is saved; try again shortly.";
}

/** True when an exit status means the in-VM timeout killed the command (SIGKILL -> 137 after the deadline). */
export function isSandboxTimeout(exitCode: number | null, elapsedMs: number, timeoutMs: number): boolean {
  return (exitCode === 137 || exitCode === null) && elapsedMs >= timeoutMs;
}

/** Explicit access-token credentials when configured outside Vercel; otherwise the SDK uses OIDC. */
function explicitCredentials(): { token: string; teamId: string; projectId: string } | Record<string, never> {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

export function sandboxCredentialsPresent(): boolean {
  const e = process.env;
  return Boolean(
    e.VERCEL_OIDC_TOKEN || (e.VERCEL_TOKEN && e.VERCEL_TEAM_ID && e.VERCEL_PROJECT_ID) || e.VERCEL === "1",
  );
}

function cappedWritable(
  acc: { text: string; bytes: number; truncated: boolean },
  limit: number,
  onData: () => void,
): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      appendCapped(acc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), limit);
      onData();
      cb();
    },
  });
}

export class VercelSandboxRunner extends DockerRunner {
  override readonly driver: string = SANDBOX_DRIVER;

  override async health(): Promise<RunnerHealth> {
    const ok = sandboxCredentialsPresent();
    return {
      driver: this.driver,
      available: ok,
      languages: { PYTHON: ok, JAVASCRIPT: ok, SCALA: false },
      detail: ok
        ? "Vercel Sandbox credentials present (Scala is not available on this driver)"
        : "No Vercel Sandbox credentials (VERCEL_OIDC_TOKEN, or VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID)",
    };
  }

  override async run(job: RunJob): Promise<RunResult> {
    if (!SANDBOX_RUNTIME[job.language]) {
      return runnerUnavailable(job.runId, this.driver, "Scala runs are not available on this deployment.");
    }
    return super.run(job);
  }

  /** SDK/auth/quota failures never become student output. */
  protected override platformFailure(job: RunJob, p: ProcResult): RunResult | null {
    return p.spawnError ? runnerUnavailable(job.runId, this.driver, p.spawnError) : null;
  }

  /** Same contract as DockerRunner.execContainer, executed in a single-use Vercel Sandbox. */
  protected override async execContainer(
    job: RunJob,
    stdinPayload: string,
    opts: { hostTimeoutMs: number; collectCap: number },
  ): Promise<ProcResult & { containerName: string }> {
    const language = job.language as "PYTHON" | "JAVASCRIPT";
    const stdout = { text: "", bytes: 0, truncated: false };
    const stderr = { text: "", bytes: 0, truncated: false };
    let timedOut = false;
    let outputLimit = false;
    let spawnError: string | null = null;
    let exitCode: number | null = null;
    let containerName = "";
    let runStart = 0;
    let runEnd = 0;

    // Whole-lifecycle deadline (create + write + setup + run): host-side backstop if the platform hangs.
    const lifecycle = new AbortController();
    const lifecycleTimer = setTimeout(
      () => lifecycle.abort(),
      opts.hostTimeoutMs + SETUP_BUDGET_MS + HOST_ABORT_SLACK_MS,
    );
    // Command-level abort: output cap exceeded or the in-VM timeout failed to fire.
    const command = new AbortController();
    const check = () => {
      if (!outputLimit && stdout.bytes + stderr.bytes >= opts.collectCap && (stdout.truncated || stderr.truncated)) {
        outputLimit = true;
        command.abort();
      }
    };

    let sandbox: Sandbox | undefined;
    try {
      const h = loadHarness(language);
      sandbox = await Sandbox.create({
        ...explicitCredentials(),
        runtime: SANDBOX_RUNTIME[language],
        // VM lifetime cap: the sandbox stops itself even if our stop() never runs.
        timeout: opts.hostTimeoutMs + SETUP_BUDGET_MS + 2 * HOST_ABORT_SLACK_MS,
        resources: { vcpus: 1 },
        networkPolicy: "deny-all",
        persistent: false,
        tags: { app: "socra", kind: "code-run" },
        signal: lifecycle.signal,
      });
      containerName = sandbox.name;
      await sandbox.writeFiles(
        [
          { path: `${IN_DIR}/bootstrap.${h.ext}`, content: Buffer.from(h.bootstrap) },
          { path: `${IN_DIR}/harness.${h.ext}`, content: Buffer.from(h.harness) },
          { path: `${IN_DIR}/payload.json`, content: Buffer.from(stdinPayload) },
        ],
        { signal: lifecycle.signal },
      );
      const setup = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", buildSetupScript(h.ext)],
        signal: lifecycle.signal,
      });
      if (setup.exitCode !== 0) {
        throw new Error(`sandbox setup failed (exit ${setup.exitCode})`);
      }

      const hostTimer = setTimeout(() => {
        timedOut = true;
        command.abort();
      }, opts.hostTimeoutMs + HOST_ABORT_SLACK_MS);
      runStart = Date.now();
      try {
        const finished = await sandbox.runCommand({
          cmd: "sh",
          args: ["-c", buildRunScript(language, job.limits.pidsLimit, opts.hostTimeoutMs)],
          // SDK-enforced backstop in case the in-VM watchdog itself is stuck.
          timeoutMs: opts.hostTimeoutMs + SDK_TIMEOUT_SLACK_MS,
          signal: AbortSignal.any([lifecycle.signal, command.signal]),
          stdout: cappedWritable(stdout, opts.collectCap, check),
          stderr: cappedWritable(stderr, Math.min(opts.collectCap, 256 * 1024), check),
        });
        exitCode = finished.exitCode;
      } catch (err) {
        // Our own abort (output cap / host deadline) is a student outcome, not a platform failure.
        if (!timedOut && !outputLimit) throw err;
      } finally {
        clearTimeout(hostTimer);
        runEnd = Date.now();
      }
      if (!outputLimit && isSandboxTimeout(exitCode, runEnd - runStart, opts.hostTimeoutMs)) timedOut = true;
    } catch (err) {
      spawnError = describeSandboxError(err);
    } finally {
      clearTimeout(lifecycleTimer);
      if (sandbox) {
        await sandbox.stop().catch(() => undefined);
      }
    }
    return {
      containerName,
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode: timedOut ? null : exitCode,
      timedOut,
      outputLimit,
      truncated: stdout.truncated || stderr.truncated,
      spawnError,
      durationMs: runStart ? (runEnd || Date.now()) - runStart : 0,
    };
  }
}
