import { NextFunction, Response } from "express";
import { env } from "../config/env";
import { getRedis } from "../db/redis";
import { AuthedRequest } from "./auth";

/**
 * Minimal Redis surface used by the sliding-window algorithm. Declaring it as
 * an interface lets unit tests pass a lightweight fake.
 */
export interface RateLimitStore {
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  /** Window length in ms (when the oldest entry will fully age out). */
  windowMs: number;
}

/**
 * Sliding-window counter backed by a Redis sorted set.
 *
 * Each request adds a timestamp-scored member; we drop members older than the
 * window, count what remains, and allow the request iff the count is within the
 * limit. Pure with respect to the injected store (clock injectable for tests).
 */
export async function checkRateLimit(
  store: RateLimitStore,
  keyId: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const key = `ratelimit:${keyId}`;
  const windowStart = now - windowMs;

  await store.zremrangebyscore(key, 0, windowStart);
  await store.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`);
  const count = await store.zcard(key);
  await store.pexpire(key, windowMs);

  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    windowMs,
  };
}

/** Express middleware enforcing the per-key sliding window. Run after authenticate. */
export async function rateLimit(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const keyId = req.apiKey?.keyId;
  if (!keyId) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  const limit = req.apiKey?.rateLimitPerMin ?? env.rateLimitDefault;

  try {
    const result = await checkRateLimit(
      getRedis() as unknown as RateLimitStore,
      keyId,
      limit,
      env.rateLimitWindowMs,
    );

    res.setHeader("x-ratelimit-limit", String(result.limit));
    res.setHeader("x-ratelimit-remaining", String(result.remaining));

    if (!result.allowed) {
      res.setHeader("retry-after", String(Math.ceil(result.windowMs / 1000)));
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    next();
  } catch {
    // Fail closed on rate-limit backend errors.
    res.status(503).json({ error: "rate limiter unavailable" });
  }
}
