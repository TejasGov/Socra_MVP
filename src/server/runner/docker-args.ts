import type { RunLimits, RunnerLanguage } from "./types";

/**
 * Pure builders for the sandbox `docker run` command line. Kept free of env/server-only imports so unit tests can
 * assert every security flag. Nothing from the app environment is ever passed into the container (no `-e`, no
 * `--env-file`, no bind mounts): code and harness arrive on stdin.
 */

export const SANDBOX_USER = "65534:65534";

export interface DockerRunSpec {
  containerName: string;
  image: string;
  limits: Pick<RunLimits, "memory" | "cpus" | "pidsLimit">;
}

export function buildDockerRunArgs(spec: DockerRunSpec): string[] {
  const { limits } = spec;
  return [
    "run",
    "--rm",
    "--name",
    spec.containerName,
    "--network",
    "none",
    "--memory",
    limits.memory,
    // swap == memory disables swap, so memory pressure is a hard OOM kill (exit 137), not slow thrashing.
    "--memory-swap",
    limits.memory,
    "--cpus",
    limits.cpus,
    "--pids-limit",
    String(limits.pidsLimit),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=64m,exec,mode=1777",
    "--tmpfs",
    "/work:rw,size=32m,exec,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    SANDBOX_USER,
    "-i",
    spec.image,
  ];
}

const NAME_RE = /[^a-zA-Z0-9_.-]/g;
export function containerNameFor(runId: string, nonce: string): string {
  return `socra-run-${runId.replace(NAME_RE, "").slice(0, 40)}-${nonce.replace(NAME_RE, "")}`;
}

export function imageFor(
  language: RunnerLanguage,
  images: { python: string; javascript: string; scala: string },
): string {
  return language === "PYTHON"
    ? images.python
    : language === "JAVASCRIPT"
      ? images.javascript
      : images.scala;
}

/** Docker memory string ("256m", "1g", "512M") -> bytes. Returns null when unparsable. */
export function parseMemoryBytes(mem: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([kmgb]?)$/i.exec(mem.trim());
  if (!m) return null;
  const mult = { "": 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2]!.toLowerCase()] ?? 1;
  return Math.floor(Number(m[1]) * mult);
}

/** Append `chunk` to `acc` without exceeding `limit` bytes of text; reports whether anything was dropped. */
export function appendCapped(
  acc: { text: string; bytes: number; truncated: boolean },
  chunk: Buffer,
  limit: number,
): void {
  if (acc.bytes >= limit) {
    if (chunk.length > 0) acc.truncated = true;
    return;
  }
  const room = limit - acc.bytes;
  if (chunk.length <= room) {
    acc.text += chunk.toString("utf8");
    acc.bytes += chunk.length;
  } else {
    acc.text += chunk.subarray(0, room).toString("utf8");
    acc.bytes = limit;
    acc.truncated = true;
  }
}
