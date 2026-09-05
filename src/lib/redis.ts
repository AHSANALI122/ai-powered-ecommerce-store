import { Redis } from "@upstash/redis";
import { serverEnv } from "@/lib/env";

/**
 * Shared state store (SEC-18).
 *
 * Vercel functions are multi-instance and stateless, so anything that must be
 * consistent across requests — rate-limit counters, checkout idempotency keys,
 * locks — lives here and never in a module-level Map.
 */

let client: Redis | null | undefined;

/**
 * Returns the Redis client, or null when Upstash is not configured. Null is
 * only reachable outside production; env validation requires the credentials
 * when NODE_ENV is production.
 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    if (env.NODE_ENV === "production") {
      throw new Error("Upstash Redis is required in production (SEC-18).");
    }
    client = null;
    return client;
  }

  client = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}

/** Throws rather than degrading, for call sites where skipping is not safe. */
export function requireRedis(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  return redis;
}

/**
 * Single source of truth for key names, so unrelated features cannot collide
 * and keys stay greppable.
 */
export const redisKeys = {
  rateLimit: (bucket: string, identifier: string) => `rl:${bucket}:${identifier}`,
  idempotency: (key: string) => `idem:checkout:${key}`,
  lock: (name: string) => `lock:${name}`,
  webhookEvent: (provider: string, eventId: string) => `wh:${provider}:${eventId}`,
} as const;
