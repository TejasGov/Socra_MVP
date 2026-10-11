import "server-only";
import { Redis } from "ioredis";
import { env } from "./env";

/**
 * Shared Redis connection (ioredis). BullMQ queues/workers create their own connections from
 * `bullConnection()` because blocking commands require dedicated sockets.
 */

const globalForRedis = globalThis as unknown as { __socraRedis?: Redis };

export function getRedis(): Redis {
  if (env().INLINE_JOBS && !process.env.REDIS_URL?.trim()) {
    // Callers already handle unavailable Redis. Avoid opening a localhost socket on serverless hosts.
    throw new Error("Redis is not configured; using inline job and rate-limit fallbacks");
  }
  if (!globalForRedis.__socraRedis) {
    globalForRedis.__socraRedis = new Redis(env().REDIS_URL, {
      // Stop reconnect loops after a few attempts (serverless without Redis); callers already fall back.
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 3000,
    });
    // Never crash the process on transient Redis errors; health checks surface them.
    globalForRedis.__socraRedis.on("error", () => undefined);
  }
  return globalForRedis.__socraRedis;
}

/** Connection options for BullMQ Queue/Worker/QueueEvents (each gets its own socket). */
export function bullConnection(): { url: string; maxRetriesPerRequest: null } {
  return { url: env().REDIS_URL, maxRetriesPerRequest: null };
}

export async function pingRedis(timeoutMs = 1500): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status === "wait") await redis.connect().catch(() => undefined);
    const ready =
      redis.status === "ready"
        ? Promise.resolve()
        : new Promise<void>((resolve) => redis.once("ready", () => resolve()));
    const result = await Promise.race([
      ready.then(() => redis.ping()),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (globalForRedis.__socraRedis) {
    globalForRedis.__socraRedis.disconnect();
    globalForRedis.__socraRedis = undefined;
  }
}
