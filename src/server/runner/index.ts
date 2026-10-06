import "server-only";
import { env } from "../env";
import { DockerRunner } from "./docker-runner";
import { parseMemoryBytes } from "./docker-args";
import { RemoteRunner } from "./remote-runner";
import {
  type CodeRunner,
  type RunLimits,
  type RunnerLanguage,
} from "./types";

/** Runner selection: CODE_RUNNER_DRIVER=docker (default, ./docker-runner.ts) or remote (./remote-runner.ts). */

let runner: CodeRunner | undefined;

export function getCodeRunner(): CodeRunner {
  runner ??= env().CODE_RUNNER_DRIVER === "remote" ? new RemoteRunner() : new DockerRunner();
  return runner;
}

export function setCodeRunnerForTests(r: CodeRunner | undefined): void {
  runner = r;
}

/** Default sandbox limits from env (Scala gets a longer timeout for compilation). */
export function defaultRunLimits(language: RunnerLanguage): RunLimits {
  const e = env();
  return {
    timeoutMs: language === "SCALA" ? e.RUNNER_SCALA_TIMEOUT_MS : e.RUNNER_TIMEOUT_MS,
    // The JVM + Scala compiler need far more than a Python/Node process (measured: 256m OOMs).
    memory: language === "SCALA" ? scalaMemory(e.RUNNER_MEMORY) : e.RUNNER_MEMORY,
    cpus: language === "SCALA" ? "1" : e.RUNNER_CPUS,
    pidsLimit: e.RUNNER_PIDS_LIMIT,
    outputLimitBytes: e.RUNNER_OUTPUT_LIMIT_BYTES,
  };
}

function scalaMemory(configured: string): string {
  const bytes = parseMemoryBytes(configured);
  return bytes !== null && bytes >= 768 * 1024 ** 2 ? configured : "768m";
}
