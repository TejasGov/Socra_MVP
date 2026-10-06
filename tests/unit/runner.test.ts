import { describe, expect, it } from "vitest";
import {
  appendCapped,
  buildDockerRunArgs,
  containerNameFor,
  parseMemoryBytes,
} from "@/server/runner/docker-args";
import { compareStdout, deepEqualJson, evaluateTest } from "@/server/runner/compare";
import { buildScalaScript, jsonToScala, parseScalaOutput } from "@/server/runner/scala-job";
import { toStudentRunResult, type RunResult, type TestResult } from "@/server/runner/types";

describe("buildDockerRunArgs", () => {
  const args = buildDockerRunArgs({
    containerName: "socra-run-x-1",
    image: "socra-runner-python:1",
    limits: { memory: "256m", cpus: "0.5", pidsLimit: 64 },
  });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("applies every sandbox security flag", () => {
    expect(args[0]).toBe("run");
    expect(args).toContain("--rm");
    expect(after("--network")).toBe("none");
    expect(after("--memory")).toBe("256m");
    expect(after("--memory-swap")).toBe("256m");
    expect(after("--cpus")).toBe("0.5");
    expect(after("--pids-limit")).toBe("64");
    expect(args).toContain("--read-only");
    expect(args).toContain("/tmp:rw,size=64m,exec,mode=1777");
    expect(args).toContain("/work:rw,size=32m,exec,mode=1777");
    expect(after("--cap-drop")).toBe("ALL");
    expect(after("--security-opt")).toBe("no-new-privileges");
    expect(after("--user")).toBe("65534:65534");
    expect(args).toContain("-i");
    expect(after("--name")).toBe("socra-run-x-1");
    expect(args.at(-1)).toBe("socra-runner-python:1");
  });

  it("never passes env vars, bind mounts, or privileged flags", () => {
    for (const bad of [
      "-e",
      "--env",
      "--env-file",
      "-v",
      "--volume",
      "--mount",
      "--privileged",
      "--network=host",
      "--pid",
      "--ipc",
    ]) {
      expect(args).not.toContain(bad);
    }
  });

  it("sanitizes container names", () => {
    expect(containerNameFor("a b;rm -rf/../x", "n!1")).toMatch(/^socra-run-[a-zA-Z0-9_.-]+-n1$/);
  });

  it("parses memory strings", () => {
    expect(parseMemoryBytes("256m")).toBe(256 * 1024 * 1024);
    expect(parseMemoryBytes("1g")).toBe(1024 ** 3);
    expect(parseMemoryBytes("nope")).toBeNull();
  });
});

describe("output truncation", () => {
  it("caps accumulated output and flags truncation", () => {
    const acc = { text: "", bytes: 0, truncated: false };
    appendCapped(acc, Buffer.from("a".repeat(60)), 100);
    expect(acc.truncated).toBe(false);
    appendCapped(acc, Buffer.from("b".repeat(60)), 100);
    expect(acc.bytes).toBe(100);
    expect(acc.text.length).toBe(100);
    expect(acc.truncated).toBe(true);
    appendCapped(acc, Buffer.from("c"), 100);
    expect(acc.text.length).toBe(100);
  });
});

describe("comparison", () => {
  it("compares JSON with numeric equality and float tolerance", () => {
    expect(deepEqualJson([1, { a: 2.0 }], [1, { a: 2 }], null)).toBe(true);
    expect(deepEqualJson(0.30000000000000004, 0.3, null)).toBe(false);
    expect(deepEqualJson(0.30000000000000004, 0.3, 1e-9)).toBe(true);
    expect(deepEqualJson([1, 2], [2, 1], null)).toBe(false);
  });
  it("normalizes stdout", () => {
    expect(compareStdout("7\n", "7", "exact")).toBe(true);
    expect(compareStdout("a  b\n", "a b", "exact")).toBe(false);
    expect(compareStdout("a  b\n", "a b", "normalized_whitespace")).toBe(true);
  });
  it("evaluates a function test", () => {
    const t = {
      id: "t",
      name: "n",
      visibility: "PUBLIC" as const,
      weight: 1,
      kind: "function" as const,
      expectedReturn: [1, 2],
    };
    expect(evaluateTest(t, { ok: true, hasJson: true, json: [1, 2] }).passed).toBe(true);
    const bad = evaluateTest(t, { ok: true, hasJson: true, json: [2, 1] });
    expect(bad.passed).toBe(false);
    expect(bad.actual).toBe("[2,1]");
  });
});

describe("scala job", () => {
  it("renders JSON args as Scala literals", () => {
    expect(jsonToScala([1, 2.5, true, null])).toBe("List(1, 2.5, true, null)");
    expect(jsonToScala("x")).toContain("Base64");
  });
  it("embeds files in base64 and parses nonce-tagged markers only", () => {
    const script = buildScalaScript({
      nonce: "N0NC3",
      files: [{ path: "main.scala", content: "@main def m = println(1)" }],
      mode: "tests",
      tests: [
        {
          id: "a",
          name: "a",
          visibility: "PUBLIC",
          weight: 1,
          kind: "stdio",
          stdin: "x",
          expectedStdout: "1",
        },
      ],
      defaultTestTimeoutMs: 5000,
    });
    expect(script).toContain("base64 -d");
    expect(script).not.toContain("println(1)");
    const forged = "@@WRONG:T:a:0:1:MQ==:@@\n";
    const real = `@@N0NC3:T:a:0:12:${Buffer.from("1\n").toString("base64")}:@@\n`;
    const parsed = parseScalaOutput(forged + real, "N0NC3");
    expect(parsed.tests.get("a")?.stdout).toBe("1\n");
    expect(parseScalaOutput(forged, "N0NC3").tests.size).toBe(0);
  });
});

describe("toStudentRunResult", () => {
  const mk = (visibility: TestResult["visibility"], i: number): TestResult => ({
    testId: `t${i}`,
    name: `test ${i}`,
    visibility,
    passed: false,
    weight: 1,
    message: `secret ${visibility}`,
    actual: "SECRET_ACTUAL",
    expected: "SECRET_EXPECTED",
  });
  const result: RunResult = {
    runId: "r",
    status: "OK",
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 5,
    testResults: [mk("PUBLIC", 1), mk("HIDDEN", 2), mk("DIAGNOSTIC", 3)],
    truncated: false,
    errorClass: null,
    runnerDriver: "docker",
  };
  it("drops hidden and diagnostic results entirely", () => {
    const s = toStudentRunResult(result);
    expect(s.testResults).toHaveLength(1);
    expect(s.testResults[0]!.visibility).toBe("PUBLIC");
    const text = JSON.stringify(s);
    expect(text).not.toContain("secret HIDDEN");
    expect(text).not.toContain("secret DIAGNOSTIC");
    expect(text).not.toContain("t2");
  });
});
