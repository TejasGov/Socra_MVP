import "server-only";
// Registers the learning-evidence consumers with the dispatcher (same import the worker uses).
import "@/server/events/consumers";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { drainOutbox } from "@/server/events/dispatcher";
import { getRedis } from "@/server/redis";
import { recomputeAggregates } from "@/server/domain/analytics";
import { embedResourceVersion } from "../../../worker/jobs/embeddings";

/**
 * Serverless replacement for the worker loop (INLINE_JOBS=true, e.g. on Vercel).
 * Called from `after()` once a mutating request has responded, so it never delays the user.
 *  - drains a bounded slice of the transactional outbox (consumers are idempotent, so overlap is safe)
 *  - refreshes analytics aggregates at most once per AGGREGATE_EVERY_S when new events were processed
 *  - embeds course-material chunks that have no vector yet, at most once per EMBED_EVERY_S
 */
const AGGREGATE_EVERY_S = 60;
const EMBED_EVERY_S = 300;

// Per-instance fallback when Redis is unavailable (throttling is then per serverless instance, which is acceptable).
const localThrottle = new Map<string, number>();

async function claimThrottle(key: string, seconds: number): Promise<boolean> {
  try {
    const ok = await getRedis().set(`inline-jobs:${key}`, "1", "EX", seconds, "NX");
    return ok === "OK";
  } catch {
    const now = Date.now();
    if ((localThrottle.get(key) ?? 0) > now) return false;
    localThrottle.set(key, now + seconds * 1000);
    return true;
  }
}

export async function runInlineJobs(): Promise<void> {
  try {
    const summary = await drainOutbox(10);
    if (summary.processed > 0 && (await claimThrottle("aggregate", AGGREGATE_EVERY_S))) {
      await recomputeAggregates();
    }
    if (!env().AI_MOCK_MODE && (await claimThrottle("embed", EMBED_EVERY_S))) {
      const pending = await prisma.$queryRaw<{ resourceId: string; sourceVersion: number }[]>`
        SELECT DISTINCT "resourceId", "sourceVersion" FROM "ResourceChunk" WHERE embedding IS NULL LIMIT 5`;
      for (const p of pending) await embedResourceVersion(p.resourceId, p.sourceVersion);
    }
  } catch (err) {
    console.error("[inline-jobs] failed", err);
  }
}
