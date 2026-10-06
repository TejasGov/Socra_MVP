/**
 * Verifies seeded coding questions locally (no database): every reference solution must pass all PUBLIC and
 * HIDDEN tests, and every buggy variant must fail exactly the tests it declares.
 * Python and JavaScript run through local `python` / `node`; Scala is checked with docker (virtuslab/scala-cli)
 * when `--scala` is passed.
 *
 * Usage: npx tsx prisma/seed/verify-reference.ts [--scala]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_ASSIGNMENTS } from "./data/all";
import type { QuestionDef, SeedTest } from "./data/types";

const PY_HARNESS = String.raw`
import sys, json, io, contextlib
sys.setrecursionlimit(1000)
tests = json.load(open("tests.json"))
ns = {"__name__": "student"}
res = {}
try:
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(open("main.py").read(), "main.py", "exec"), ns)
except BaseException as e:
    for t in tests: res[t["id"]] = False
    print(json.dumps(res)); sys.exit(0)
for t in tests:
    try:
        out = ns[t["entryPoint"]](*t["args"])
        res[t["id"]] = (out == t["expectedReturn"])
    except BaseException:
        res[t["id"]] = False
print(json.dumps(res))
`;

const JS_HARNESS = String.raw`
const fs = require("fs");
const assert = require("assert");
const tests = JSON.parse(fs.readFileSync("tests.json", "utf8"));
const code = fs.readFileSync("main.js", "utf8");
const res = {};
const realLog = console.log; console.log = () => {};
let fns;
try { fns = new Function(code + "\n;return {" + [...new Set(tests.map(t => t.entryPoint))].join(",") + "};")(); }
catch (e) { for (const t of tests) res[t.id] = false; console.log = realLog; console.log(JSON.stringify(res)); process.exit(0); }
for (const t of tests) {
  try { assert.deepStrictEqual(fns[t.entryPoint](...t.args), t.expectedReturn); res[t.id] = true; }
  catch (e) { res[t.id] = false; }
}
console.log = realLog; console.log(JSON.stringify(res));
`;

function runFunctionTests(q: QuestionDef, code: string): Record<string, boolean> {
  const dir = mkdtempSync(join(tmpdir(), "socra-verify-"));
  const tests = q.tests.filter((t) => t.kind === "function");
  writeFileSync(join(dir, "tests.json"), JSON.stringify(tests));
  if (q.language === "PYTHON") {
    writeFileSync(join(dir, "main.py"), code);
    writeFileSync(join(dir, "harness.py"), PY_HARNESS);
    const r = spawnSync("python", ["harness.py"], { cwd: dir, encoding: "utf8", timeout: 20000 });
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}");
  }
  writeFileSync(join(dir, "main.js"), code);
  writeFileSync(join(dir, "harness.js"), JS_HARNESS);
  const r = spawnSync("node", ["harness.js"], { cwd: dir, encoding: "utf8", timeout: 20000 });
  return JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}");
}

function norm(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(" ");
}

function runStdioTests(q: QuestionDef, code: string, scala: boolean): Record<string, boolean> {
  const dir = mkdtempSync(join(tmpdir(), "socra-verify-"));
  const res: Record<string, boolean> = {};
  const tests = q.tests.filter((t): t is SeedTest => t.kind === "stdio");
  if (q.language === "SCALA") {
    if (!scala) return Object.fromEntries(tests.map((t) => [t.id, true]));
    writeFileSync(join(dir, "Main.scala"), code);
    for (const t of tests) {
      const r = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "-v",
          `${dir}:/w`,
          "-w",
          "/w",
          "virtuslab/scala-cli",
          "run",
          "Main.scala",
          "--main-class",
          "Main",
        ],
        { input: t.stdin ?? "", encoding: "utf8", timeout: 240000 },
      );
      res[t.id] = r.status === 0 && norm(r.stdout) === norm(t.expectedStdout ?? "");
    }
    return res;
  }
  writeFileSync(join(dir, "main.py"), code);
  for (const t of tests) {
    const r = spawnSync("python", ["main.py"], {
      cwd: dir,
      input: t.stdin ?? "",
      encoding: "utf8",
      timeout: 1500,
    });
    res[t.id] = r.status === 0 && !r.error && norm(r.stdout) === norm(t.expectedStdout ?? "");
  }
  return res;
}

function runTests(q: QuestionDef, code: string, scala: boolean) {
  return q.tests[0]?.kind === "stdio" ? runStdioTests(q, code, scala) : runFunctionTests(q, code);
}

const scala = process.argv.includes("--scala");
let bad = 0;
for (const a of ALL_ASSIGNMENTS) {
  for (const q of a.questions) {
    if (q.type !== "CODING") continue;
    if (q.language === "SCALA" && !scala) {
      console.log(`SKIP  ${a.courseKey}/${a.key}/${q.key} (scala; pass --scala)`);
      continue;
    }
    const ref = runTests(q, q.reference ?? "", scala);
    const refFail = q.tests.filter((t) => !ref[t.id]).map((t) => t.id);
    console.log(
      `${refFail.length ? "FAIL" : "OK  "}  ${a.courseKey}/${a.key}/${q.key} reference` +
        (refFail.length ? ` failing: ${refFail}` : ""),
    );
    if (refFail.length) bad++;
    for (const v of q.variants) {
      const r = runTests(q, v.code, scala);
      const actual = q.tests
        .filter((t) => !r[t.id])
        .map((t) => t.id)
        .sort();
      const declared = [...v.failing].sort();
      const same = JSON.stringify(actual) === JSON.stringify(declared);
      console.log(
        `${same ? "OK  " : "DIFF"}  ${a.courseKey}/${a.key}/${q.key} variant ${v.key}` +
          (same ? "" : ` declared=${declared} actual=${actual}`),
      );
      if (!same) bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
