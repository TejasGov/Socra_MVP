import "server-only";
import { z } from "zod";

/**
 * Zod-validated server environment.
 *
 * - Never import from client components (it would leak nothing because of `server-only`, but it would break the build).
 * - Optional integrations (OpenAI, OIDC, S3, remote runner) never crash pages when absent: their absence switches the
 *   relevant adapter to its local/mock implementation.
 * - `AI_MOCK_MODE` is DERIVED: true when OPENAI_API_KEY is absent, or when explicitly set to "true".
 *
 * `parseEnv(raw)` is pure (used by tests); `env()` memoizes the parse of `process.env`.
 */

const DEV_DATABASE_URL = "postgresql://socra:socra@localhost:5544/socra?schema=public";
const DEV_REDIS_URL = "redis://localhost:6390";
const DEV_SESSION_SECRET = "dev-only-insecure-session-secret-change-me-0000000000";
const DEV_PSEUDONYM_SECRET = "dev-only-insecure-research-pseudonym-secret-000000000";

/** "true"/"1"/"yes"/"on" -> true, "false"/"0"/"no"/"off" -> false, empty/undefined -> default. */
const bool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return defaultValue;
      const s = v.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(s)) return true;
      if (["false", "0", "no", "off"].includes(s)) return false;
      ctx.addIssue({ code: "custom", message: `Expected a boolean, got "${v}"` });
      return z.NEVER;
    });

/** Tri-state boolean: undefined when unset/empty. */
const optionalBool = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v.trim() === "") return undefined;
    return ["true", "1", "yes", "on"].includes(v.trim().toLowerCase());
  });

const numeric = (defaultValue: number, min: number, integer: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === "") return defaultValue;
      const n = Number(v.trim());
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min) {
        ctx.addIssue({
          code: "custom",
          message: `Expected ${integer ? "an integer" : "a number"} >= ${min}, got "${v}"`,
        });
        return z.NEVER;
      }
      return n;
    });

const int = (defaultValue: number, min = 0) => numeric(defaultValue, min, true);
const num = (defaultValue: number, min = 0) => numeric(defaultValue, min, false);

const str = (defaultValue: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? defaultValue : v.trim()));

/** Optional string: empty string is treated as unset. */
const optStr = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional().default("development"),

  // App
  APP_URL: str("http://localhost:3000"),
  APP_VERSION: str("0.1.0"),
  /**
   * Trust X-Forwarded-For / X-Forwarded-Host / X-Forwarded-Proto. Enable only behind a reverse proxy that overwrites
   * them; otherwise clients can spoof their IP (login rate limit, audit) and the CSRF host check.
   */
  TRUST_PROXY: bool(false),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),

  // Data stores
  DATABASE_URL: optStr,
  REDIS_URL: optStr,

  // Sessions / auth
  SESSION_SECRET: optStr,
  SESSION_TTL_HOURS: int(12, 1),
  AUTH_LOCAL_ENABLED: bool(true),
  OIDC_ISSUER: optStr,
  OIDC_CLIENT_ID: optStr,
  OIDC_CLIENT_SECRET: optStr,
  OIDC_REDIRECT_URI: optStr,
  OIDC_SCOPES: str("openid email profile"),
  OIDC_EMAIL_CLAIM: str("email"),
  /** When true, unknown OIDC subjects with no matching user are created as STUDENT. Default: deny. */
  OIDC_AUTO_PROVISION: bool(false),
  RATE_LIMIT_LOGIN_PER_15_MIN: int(20, 1),

  // AI
  AI_MOCK_MODE: optionalBool,
  OPENAI_API_KEY: optStr,
  OPENAI_BASE_URL: optStr,
  OPENAI_ORG_ID: optStr,
  OPENAI_PROTECTED_MODEL: str("gpt-6.1-sol"),
  OPENAI_ECONOMY_MODEL: str("gpt-6-luna"),
  OPENAI_EMBEDDING_MODEL: str("text-embedding-3-small"),
  OPENAI_TIMEOUT_MS: int(30000, 1000),
  /** Timeout for long structured generations (assignment/quiz authoring, practice item generation, grading suggestions). */
  OPENAI_LONG_TIMEOUT_MS: int(150000, 1000),
  OPENAI_MAX_RETRIES: int(2, 0),
  OPENAI_MAX_OUTPUT_TOKENS: int(900, 64),
  AI_KILL_SWITCH: bool(false),
  AI_MAX_TURNS_PER_SESSION: int(30, 1),
  AI_MAX_TURNS_PER_USER_DAY: int(150, 1),
  AI_COURSE_BUDGET_USD: num(250, 0),
  AI_BUDGET_ALERT_PCT: int(80, 1),
  AI_MAX_INPUT_TOKENS_PER_REQUEST: int(16000, 1000),
  AI_RATE_LIMIT_PER_MINUTE: int(12, 1),
  // Planning prices, USD per 1M tokens (digest §2.11). Override when contracts change.
  AI_PRICE_PROTECTED_INPUT_PER_1M: num(2.0),
  AI_PRICE_PROTECTED_CACHED_INPUT_PER_1M: num(0.2),
  AI_PRICE_PROTECTED_OUTPUT_PER_1M: num(10.0),
  AI_PRICE_ECONOMY_INPUT_PER_1M: num(0.1),
  AI_PRICE_ECONOMY_CACHED_INPUT_PER_1M: num(0.01),
  AI_PRICE_ECONOMY_OUTPUT_PER_1M: num(0.5),
  AI_PRICE_EMBEDDING_PER_1M: num(0.02),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).optional().default("local"),
  LOCAL_STORAGE_DIR: str("./storage"),
  S3_BUCKET: optStr,
  S3_REGION: optStr,
  S3_ENDPOINT: optStr,
  S3_ACCESS_KEY_ID: optStr,
  S3_SECRET_ACCESS_KEY: optStr,
  S3_FORCE_PATH_STYLE: bool(false),

  // Code runner
  CODE_RUNNER_DRIVER: z.enum(["docker", "remote"]).optional().default("docker"),
  RUNNER_TIMEOUT_MS: int(10000, 500),
  RUNNER_SCALA_TIMEOUT_MS: int(45000, 1000),
  RUNNER_MEMORY: str("256m"),
  RUNNER_CPUS: str("0.5"),
  RUNNER_PIDS_LIMIT: int(64, 8),
  RUNNER_OUTPUT_LIMIT_BYTES: int(65536, 1024),
  RUNNER_CONCURRENCY: int(4, 1),
  RUNNER_WAIT_TIMEOUT_MS: int(60000, 1000),
  RUNNER_IMAGE_PYTHON: str("socra-runner-python:1"),
  RUNNER_IMAGE_JAVASCRIPT: str("socra-runner-node:1"),
  RUNNER_IMAGE_SCALA: str("socra-runner-scala:1"),
  REMOTE_RUNNER_URL: optStr,
  REMOTE_RUNNER_TOKEN: optStr,

  // Worker / outbox
  WORKER_HEALTH_PORT: int(3001, 1),
  OUTBOX_POLL_INTERVAL_MS: int(1000, 100),
  /**
   * Serverless hosting (e.g. Vercel) has no long-running worker. When true, mutating API requests drain the
   * transactional outbox after the response is sent, and refresh aggregates / missing embeddings on a throttle.
   */
  INLINE_JOBS: bool(false),
  OUTBOX_BATCH_SIZE: int(50, 1),
  OUTBOX_MAX_ATTEMPTS: int(8, 1),

  // Analytics
  ANALYTICS_SMALL_N_THRESHOLD: int(5, 1),
  ANALYTICS_TIMEZONE: str("America/New_York"),

  // Research
  RESEARCH_PSEUDONYM_SECRET: optStr,
  RESEARCH_EXPORT_DIR: str("./storage/exports"),

  // Retention (days; 0 = no automatic action). Enforcement is off until RETENTION_ENFORCE=true.
  RETENTION_ENFORCE: bool(false),
  RETENTION_IDENTITY_DAYS: int(0),
  RETENTION_SUBMISSIONS_DAYS: int(0),
  RETENTION_GRADES_DAYS: int(0),
  RETENTION_RAW_AI_MESSAGES_DAYS: int(365),
  RETENTION_AI_REQUEST_LOGS_DAYS: int(400),
  RETENTION_LEARNING_EVIDENCE_DAYS: int(0),
  RETENTION_AGGREGATES_DAYS: int(0),
  RETENTION_RESEARCH_DAYS: int(0),
  RETENTION_AUDIT_LOG_DAYS: int(2555),
  RETENTION_SESSIONS_DAYS: int(30),

  // Feature flag environment defaults (course overrides live in the FeatureFlag table)
  FEATURE_PROTECTED_SOCRA: bool(true),
  FEATURE_PRACTICE_GENERATION: bool(true),
  FEATURE_LEARNER_PROFILE: bool(true),
  FEATURE_FACULTY_ANALYTICS: bool(true),
  FEATURE_INDIVIDUAL_ANALYTICS: bool(true),
  FEATURE_AI_GRADING_SUGGESTIONS: bool(true),
  FEATURE_COURSE_RAG: bool(true),
  FEATURE_POST_ASSESSMENT_SOLUTIONS: bool(true),
  FEATURE_FACULTY_AI_AUTHORING: bool(true),
});

export type RawEnv = z.infer<typeof rawSchema>;

export interface Env extends Omit<
  RawEnv,
  "AI_MOCK_MODE" | "DATABASE_URL" | "REDIS_URL" | "SESSION_SECRET" | "RESEARCH_PSEUDONYM_SECRET"
> {
  DATABASE_URL: string;
  REDIS_URL: string;
  SESSION_SECRET: string;
  RESEARCH_PSEUDONYM_SECRET: string;
  /** Derived: true when no OpenAI key is configured or mock is forced. */
  AI_MOCK_MODE: boolean;
  /** Why mock mode is on/off (for health/admin pages). */
  AI_MODE_REASON: "forced_mock" | "no_api_key" | "openai";
  /** True when all four OIDC_* variables are present. */
  OIDC_CONFIGURED: boolean;
  IS_PRODUCTION: boolean;
  /** Non-fatal configuration warnings (shown on health/admin pages, logged once). */
  warnings: string[];
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/** Pure parser — no access to process.env. Throws EnvError only for invalid values or production misconfig. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = rawSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid environment configuration: ${issues}`);
  }
  const e = result.data;
  // During `next build` route modules may be evaluated without runtime secrets; enforce strictly at runtime only.
  const isBuildPhase = raw.NEXT_PHASE === "phase-production-build";
  const isProd = e.NODE_ENV === "production" && !isBuildPhase;
  const warnings: string[] = [];

  const required = <T extends string | undefined>(
    name: string,
    value: T,
    devDefault: string,
  ): string => {
    if (value) return value;
    if (isProd) throw new EnvError(`${name} is required in production`);
    warnings.push(`${name} not set; using local development default`);
    return devDefault;
  };

  const sessionSecret = required("SESSION_SECRET", e.SESSION_SECRET, DEV_SESSION_SECRET);
  if (sessionSecret.length < 32) {
    if (isProd) throw new EnvError("SESSION_SECRET must be at least 32 characters");
    warnings.push("SESSION_SECRET is shorter than 32 characters");
  }
  const pseudonymSecret = required(
    "RESEARCH_PSEUDONYM_SECRET",
    e.RESEARCH_PSEUDONYM_SECRET,
    DEV_PSEUDONYM_SECRET,
  );

  let aiMockMode: boolean;
  let reason: Env["AI_MODE_REASON"];
  if (e.AI_MOCK_MODE === true) {
    aiMockMode = true;
    reason = "forced_mock";
  } else if (!e.OPENAI_API_KEY) {
    aiMockMode = true;
    reason = "no_api_key";
    if (e.AI_MOCK_MODE === false) {
      warnings.push("AI_MOCK_MODE=false but OPENAI_API_KEY is empty; staying in mock mode");
    }
  } else {
    aiMockMode = false;
    reason = "openai";
  }

  const oidcConfigured = Boolean(
    e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET && e.OIDC_REDIRECT_URI,
  );
  if (!oidcConfigured && (e.OIDC_ISSUER || e.OIDC_CLIENT_ID)) {
    warnings.push(
      "OIDC is partially configured; set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI",
    );
  }
  if (!e.AUTH_LOCAL_ENABLED && !oidcConfigured) {
    warnings.push("AUTH_LOCAL_ENABLED=false and OIDC is not configured; nobody can sign in");
  }
  if (e.STORAGE_DRIVER === "s3" && !e.S3_BUCKET) {
    if (isProd) throw new EnvError("STORAGE_DRIVER=s3 requires S3_BUCKET");
    warnings.push("STORAGE_DRIVER=s3 without S3_BUCKET");
  }
  if (e.CODE_RUNNER_DRIVER === "remote" && !e.REMOTE_RUNNER_URL) {
    warnings.push(
      "CODE_RUNNER_DRIVER=remote without REMOTE_RUNNER_URL; code runs will report RUNNER_UNAVAILABLE",
    );
  }

  const {
    AI_MOCK_MODE: _ignoredMock,
    DATABASE_URL,
    REDIS_URL,
    SESSION_SECRET: _s,
    RESEARCH_PSEUDONYM_SECRET: _r,
    ...rest
  } = e;

  return {
    ...rest,
    DATABASE_URL: required("DATABASE_URL", DATABASE_URL, DEV_DATABASE_URL),
    REDIS_URL: required("REDIS_URL", REDIS_URL, DEV_REDIS_URL),
    SESSION_SECRET: sessionSecret,
    RESEARCH_PSEUDONYM_SECRET: pseudonymSecret,
    AI_MOCK_MODE: aiMockMode,
    AI_MODE_REASON: reason,
    OIDC_CONFIGURED: oidcConfigured,
    IS_PRODUCTION: e.NODE_ENV === "production",
    warnings,
  };
}

let cached: Env | undefined;
let warned = false;

/** Memoized, validated environment for the current process. */
export function env(): Env {
  if (!cached) {
    cached = parseEnv(process.env);
    if (!warned && cached.warnings.length > 0 && cached.NODE_ENV !== "test") {
      warned = true;
      for (const w of cached.warnings) console.warn(`[env] ${w}`);
    }
  }
  return cached;
}

/** Test helper: forget the memoized env. */
export function resetEnvCache(): void {
  cached = undefined;
  warned = false;
}
