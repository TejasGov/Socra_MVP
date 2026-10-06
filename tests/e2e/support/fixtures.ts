import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

export const PASSWORD = "socra-dev-password";
export const USERS = {
  student: "student1@socra.local",
  faculty: "faculty@socra.local",
  research: "research@socra.local",
  admin: "admin@socra.local",
} as const;
export type Role = keyof typeof USERS;

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const stateCache = new Map<string, StorageState>();

function baseUrlOf(info: TestInfo): string {
  return (info.project.use.baseURL as string | undefined) ?? "http://localhost:3000";
}

const AUTH_DIR = join(process.cwd(), "test-results", ".auth");
const MAX_AGE_MS = 20 * 60 * 1000;

/**
 * Sign in through the real login API once per account and reuse the cookie jar (storageState),
 * in memory and on disk, so repeated runs stay under the login rate limit. A cached state is only
 * reused if /api/me still accepts it (e.g. not invalidated by a DB reset).
 */
export async function storageStateFor(
  browser: Browser,
  email: string,
  info: TestInfo,
): Promise<StorageState> {
  const baseURL = baseUrlOf(info);
  const file = join(AUTH_DIR, `${email}.json`);
  const candidates: StorageState[] = [];
  const mem = stateCache.get(email);
  if (mem) candidates.push(mem);
  try {
    if (Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) {
      candidates.push(JSON.parse(readFileSync(file, "utf8")) as StorageState);
    }
  } catch {
    /* no usable cache */
  }
  for (const state of candidates) {
    const probe = await browser.newContext({ baseURL, storageState: state });
    const ok = (await probe.request.get("/api/me")).ok();
    await probe.close();
    if (ok) {
      stateCache.set(email, state);
      return state;
    }
  }

  const ctx = await browser.newContext({ baseURL });
  const res = await ctx.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  if (!res.ok()) {
    const detail = `HTTP ${res.status()} ${await res.text().catch(() => "")}`;
    await ctx.close();
    throw new Error(`Login as ${email} failed: ${detail}`);
  }
  const state = await ctx.storageState();
  await ctx.close();
  stateCache.set(email, state);
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(state));
  return state;
}

export async function pageAs(browser: Browser, email: string, info: TestInfo) {
  const storageState = await storageStateFor(browser, email, info);
  const context = await browser.newContext({ baseURL: baseUrlOf(info), storageState });
  const page = await context.newPage();
  return { context, page };
}

interface Fixtures {
  /** Opens a page signed in as the given email; closed automatically after the test. */
  signedIn: (email: string) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  signedIn: async ({ browser }, use, info) => {
    const contexts: BrowserContext[] = [];
    await use(async (email: string) => {
      const { context, page } = await pageAs(browser, email, info);
      contexts.push(context);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect } from "@playwright/test";

/** Run a read-only query against the app database (for locating seeded rows). */
export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const url = (process.env.DATABASE_URL ?? "").replace(/\?.*$/, "");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

export async function assignmentIdByTitle(title: string): Promise<string> {
  const rows = await dbQuery<{ id: string }>(
    `select id from "Assignment" where title like $1 order by "createdAt" asc limit 1`,
    [`${title}%`],
  );
  if (!rows[0]) throw new Error(`Seeded assignment "${title}" not found. Run npm run db:seed.`);
  return rows[0].id;
}
