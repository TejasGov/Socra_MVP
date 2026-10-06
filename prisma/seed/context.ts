import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Shared seed context. Seed modules are composable: each exports `seedX(ctx)` and must be idempotent
 * (upserts keyed by deterministic ids or natural unique keys). Later modules read what earlier ones created
 * through `ctx.ids` instead of re-querying.
 */
export interface SeedContext {
  prisma: PrismaClient;
  /** bcrypt hash of DEMO_PASSWORD (computed once per run). */
  passwordHash: string;
  /** Fixed "now" so generated timestamps are deterministic within a run (relative offsets are stable). */
  now: Date;
  ids: {
    users: Record<string, string>;
    courses: Record<string, string>;
    /** `${courseKey}:${topicKey}` -> topic id */
    topics: Record<string, string>;
  };
  log: (msg: string) => void;
}

/** Password for every seeded account (documented in README). */
export const DEMO_PASSWORD = "socra-dev-password";

/** Deterministic id helper: stable, readable ids across runs (e.g. sid("course", "cse115")). */
export function sid(kind: string, ...parts: Array<string | number>): string {
  return [kind, ...parts]
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

/** Small deterministic PRNG (mulberry32) for synthetic data generators. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
