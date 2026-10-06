import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/server/env";
import type { DbOrTx } from "@/server/db";
import { FLAG_KEYS, getAllFlags, isEnabled, resolveFlag } from "@/server/flags";

describe("flags: precedence (pure)", () => {
  it("env default applies when no rows", () => {
    expect(resolveFlag({ envDefault: true })).toEqual({ enabled: true, source: "env_default" });
    expect(resolveFlag({ envDefault: false })).toEqual({ enabled: false, source: "env_default" });
  });

  it("environment row overrides env default", () => {
    expect(resolveFlag({ envDefault: true, environmentRow: false })).toEqual({
      enabled: false,
      source: "environment_override",
    });
  });

  it("course row overrides everything", () => {
    expect(resolveFlag({ envDefault: false, environmentRow: false, courseRow: true })).toEqual({
      enabled: true,
      source: "course",
    });
    expect(resolveFlag({ envDefault: true, environmentRow: true, courseRow: false })).toEqual({
      enabled: false,
      source: "course",
    });
  });
});

/** Minimal fake of `db.featureFlag.findMany` honoring the where clause used by the flags module. */
function fakeDb(rows: Array<{ key: string; scopeKey: string; enabled: boolean }>): DbOrTx {
  return {
    featureFlag: {
      findMany: async ({
        where,
      }: {
        where: { key: { in: string[] }; scopeKey: { in: string[] } };
      }) =>
        rows.filter((r) => where.key.in.includes(r.key) && where.scopeKey.in.includes(r.scopeKey)),
    },
  } as unknown as DbOrTx;
}

describe("flags: isEnabled with rows", () => {
  afterEach(() => {
    delete process.env.FEATURE_COURSE_RAG;
    resetEnvCache();
  });

  it("course override beats environment override beats env var", async () => {
    process.env.FEATURE_COURSE_RAG = "true";
    resetEnvCache();
    const db = fakeDb([
      { key: "courseRag", scopeKey: "env", enabled: false },
      { key: "courseRag", scopeKey: "course_1", enabled: true },
    ]);
    expect(await isEnabled("courseRag", {}, db)).toBe(false);
    expect(await isEnabled("courseRag", { courseId: "course_1" }, db)).toBe(true);
    expect(await isEnabled("courseRag", { courseId: "course_2" }, db)).toBe(false);
  });

  it("falls back to FEATURE_* env var", async () => {
    process.env.FEATURE_COURSE_RAG = "false";
    resetEnvCache();
    expect(await isEnabled("courseRag", { courseId: "course_1" }, fakeDb([]))).toBe(false);
  });

  it("getAllFlags returns every flag with its source", async () => {
    const all = await getAllFlags(
      { courseId: "course_1" },
      fakeDb([{ key: "learnerProfile", scopeKey: "course_1", enabled: false }]),
    );
    expect(all.map((f) => f.key)).toEqual([...FLAG_KEYS]);
    expect(all.find((f) => f.key === "learnerProfile")).toMatchObject({
      enabled: false,
      source: "course",
    });
  });
});
