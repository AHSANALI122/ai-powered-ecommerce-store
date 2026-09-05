import { Ratelimit } from "@upstash/ratelimit";
import { getRedis, redisKeys } from "@/lib/redis";
import { serverEnv } from "@/lib/env";

/**
 * Redis-backed sliding-window rate limiting (SEC-8, SEC-18).
 *
 * Counters live in Redis, not process memory: a Vercel deployment runs many
 * instances, so an in-memory counter would let an attacker multiply their
 * budget by the number of warm lambdas.
 */

export type RateLimitBucket =
  | "auth:login"
  | "auth:register"
  | "auth:reset"
  | "auth:refresh"
  | "review:submit"
  | "ai:chat"
  | "checkout";

type Window = `${number} ${"ms" | "s" | "m" | "h" | "d"}`;

interface BucketConfig {
  readonly limit: number;
  readonly window: Window;
}

/** Per-bucket budgets. Tighten in production rather than loosening in code. */
const BUCKETS: Record<RateLimitBucket, BucketConfig> = {
  "auth:login": { limit: 5, window: "15 m" },
  "auth:register": { limit: 5, window: "1 h" },
  "auth:reset": { limit: 5, window: "1 h" },
  "auth:refresh": { limit: 60, window: "15 m" },
  "review:submit": { limit: 5, window: "1 h" },
  "ai:chat": { limit: 30, window: "1 h" },
  checkout: { limit: 20, window: "10 m" },
};

const limiters = new Map<RateLimitBucket, Ratelimit>();

function getLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const existing = limiters.get(bucket);
  if (existing) return existing;

  const config = BUCKETS[bucket];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.limit, config.window),
    prefix: redisKeys.rateLimit(bucket, ""),
    analytics: false,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch ms at which the window resets. */
  readonly reset: number;
}

/**
 * Consumes one unit from `bucket` for `identifier` (an IP, a user id, or
 * `ip:email`). When Redis is unconfigured in development this allows the
 * request and warns; production env validation makes that state unreachable.
 */
export async function rateLimit(
  bucket: RateLimitBucket,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(bucket);
  const config = BUCKETS[bucket];

  if (!limiter) {
    if (serverEnv().NODE_ENV !== "test") {
      console.warn(
        `[rate-limit] Redis not configured; "${bucket}" is not being enforced.`,
      );
    }
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit,
      reset: Date.now(),
    };
  }

  const result = await limiter.limit(identifier);
  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

/** Headers to attach to a throttled response. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "RateLimit-Reset": String(Math.ceil((result.reset - Date.now()) / 1000)),
  };
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for; the left-most entry is
 * the client. Falls back to a constant so a missing header throttles as one
 * shared bucket rather than silently disabling the limit.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
