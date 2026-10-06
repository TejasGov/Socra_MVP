import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/server/env";

describe("env: AI mock mode derivation", () => {
  it("is mock when OPENAI_API_KEY is absent", () => {
    const e = parseEnv({ NODE_ENV: "development" });
    expect(e.AI_MOCK_MODE).toBe(true);
    expect(e.AI_MODE_REASON).toBe("no_api_key");
  });

  it("treats an empty key as absent", () => {
    expect(parseEnv({ OPENAI_API_KEY: "   " }).AI_MOCK_MODE).toBe(true);
  });

  it("uses OpenAI when a key is present and mock is not forced", () => {
    const e = parseEnv({ OPENAI_API_KEY: "sk-test" });
    expect(e.AI_MOCK_MODE).toBe(false);
    expect(e.AI_MODE_REASON).toBe("openai");
  });

  it("AI_MOCK_MODE=true forces mock even with a key", () => {
    const e = parseEnv({ OPENAI_API_KEY: "sk-test", AI_MOCK_MODE: "true" });
    expect(e.AI_MOCK_MODE).toBe(true);
    expect(e.AI_MODE_REASON).toBe("forced_mock");
  });

  it("AI_MOCK_MODE=false without a key stays mock and warns", () => {
    const e = parseEnv({ AI_MOCK_MODE: "false" });
    expect(e.AI_MOCK_MODE).toBe(true);
    expect(e.warnings.join(" ")).toMatch(/AI_MOCK_MODE=false/);
  });
});

describe("env: defaults and validation", () => {
  it("fills dev defaults without crashing", () => {
    const e = parseEnv({});
    expect(e.DATABASE_URL).toContain("5544");
    expect(e.REDIS_URL).toContain("6390");
    expect(e.OPENAI_PROTECTED_MODEL).toBe("gpt-6.1-sol");
    expect(e.OPENAI_ECONOMY_MODEL).toBe("gpt-6-luna");
    expect(e.OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(e.ANALYTICS_SMALL_N_THRESHOLD).toBe(5);
    expect(e.OIDC_CONFIGURED).toBe(false);
  });

  it("parses numbers and booleans", () => {
    const e = parseEnv({
      RUNNER_TIMEOUT_MS: "5000",
      AI_KILL_SWITCH: "yes",
      FEATURE_COURSE_RAG: "0",
    });
    expect(e.RUNNER_TIMEOUT_MS).toBe(5000);
    expect(e.AI_KILL_SWITCH).toBe(true);
    expect(e.FEATURE_COURSE_RAG).toBe(false);
  });

  it("rejects invalid values", () => {
    expect(() => parseEnv({ RUNNER_TIMEOUT_MS: "fast" })).toThrow(EnvError);
    expect(() => parseEnv({ AI_KILL_SWITCH: "maybe" })).toThrow(EnvError);
  });

  it("requires secrets in production", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://x/y", REDIS_URL: "redis://x" }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("does not enforce production secrets during next build", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }),
    ).not.toThrow();
  });

  it("detects full OIDC configuration", () => {
    const e = parseEnv({
      OIDC_ISSUER: "https://idp.example.edu",
      OIDC_CLIENT_ID: "socra",
      OIDC_CLIENT_SECRET: "s",
      OIDC_REDIRECT_URI: "http://localhost:3000/api/auth/oidc/callback",
    });
    expect(e.OIDC_CONFIGURED).toBe(true);
  });
});
