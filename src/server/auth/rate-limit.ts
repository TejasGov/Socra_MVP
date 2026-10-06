import "server-only";
import { getRedis } from "../redis";

/**
 * Fixed-window rate limiter backed by Redis (INCR + PEXPIRE). If Redis is unavailable it falls back to an
 * in-process window so that login keeps working in degraded mode (documented in docs/SECURITY.md).
 */

const memory = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const redis = getRedis();
    if (redis.status !== "ready") throw new Error("redis not ready");
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.pexpire(redisKey, windowMs);
    const ttl = await redis.pttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetMs: ttl > 0 ? ttl : windowMs,
    };
  } catch {
    const now = Date.now();
    const entry = memory.get(redisKey);
    if (!entry || entry.resetAt <= now) {
      memory.set(redisKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, resetMs: windowMs };
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      resetMs: entry.resetAt - now,
    };
  }
}
