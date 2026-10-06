#!/usr/bin/env node
/**
 * Pre-pull base images and build the Socra runner images (python, node, scala). Run once per machine / in CI:
 *   node scripts/runner-pull.mjs [--skip-scala]
 * Images (tags match RUNNER_IMAGE_* defaults in src/server/env.ts):
 *   socra-runner-python:1  <- python:3.12-alpine
 *   socra-runner-node:1    <- node:22-alpine
 *   socra-runner-scala:1   <- virtuslab/scala-cli (official Scala CLI image, ~5GB; Scala 3 compiler cache baked in
 *                              at build time because sandboxes run with --network none)
 * Bump the tag suffix (and RUNNER_IMAGE_*) when docker/runner/* changes.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docker", "runner");
const skipScala = process.argv.includes("--skip-scala");
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };

function docker(args) {
  console.log(`> docker ${args.join(" ")}`);
  const r = spawnSync("docker", args, { stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`docker ${args[0]} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const targets = [
  { base: "python:3.12-alpine", file: "python.Dockerfile", tag: process.env.RUNNER_IMAGE_PYTHON ?? "socra-runner-python:1" },
  { base: "node:22-alpine", file: "node.Dockerfile", tag: process.env.RUNNER_IMAGE_JAVASCRIPT ?? "socra-runner-node:1" },
  ...(skipScala
    ? []
    : [{ base: "virtuslab/scala-cli:latest", file: "scala.Dockerfile", tag: process.env.RUNNER_IMAGE_SCALA ?? "socra-runner-scala:1" }]),
];
for (const t of targets) {
  docker(["pull", t.base]);
  docker(["build", "-f", path.join(dir, t.file), "-t", t.tag, dir]);
}
console.log("runner images ready:", targets.map((t) => t.tag).join(", "));
