import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DEMO_MODE opens two production guards and must not open the others.
 *
 * The value of a flag like this is entirely in where it stops. These pin that
 * boundary, because the pressure on it is one-directional: the next person
 * fighting a failing deploy will be tempted to widen it, and the two guards it
 * leaves shut are shut for a different reason than the two it opens.
 */

const BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@example.com:5432/db",
  AUTH_SECRET: "test-secret-value-that-is-long-enough-32b",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  IMAGE_STORE: "blob",
  BLOB_READ_WRITE_TOKEN: "blob-token",
  EMAIL_DRIVER: "resend",
  RESEND_API_KEY: "re_key",
  AI_ASSISTANT_ENABLED: "false",
};

const saved = { ...process.env };

/** Boot the module fresh against a given environment. */
async function boot(overrides: Record<string, string>) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NEXT_PHASE")) delete process.env[key];
  }
  Object.assign(process.env, BASE, overrides);
  vi.resetModules();
  const { serverEnv } = await import("@/lib/env");
  return serverEnv();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

describe("DEMO_MODE in production", () => {
  it("refuses fake payments when it is off", async () => {
    await expect(boot({ PAYMENT_PROVIDER: "fake", DEMO_MODE: "false" })).rejects.toThrow(
      /PAYMENT_PROVIDER="fake" cannot be used in production/,
    );
  });

  it("allows fake payments when it is on", async () => {
    const env = await boot({ PAYMENT_PROVIDER: "fake", DEMO_MODE: "true" });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.PAYMENT_PROVIDER).toBe("fake");
  });

  it("refuses the free AI tier when it is off", async () => {
    await expect(
      boot({
        PAYMENT_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk",
        STRIPE_WEBHOOK_SECRET: "whsec",
        AI_ASSISTANT_ENABLED: "true",
        GOOGLE_GENERATIVE_AI_API_KEY: "key",
        AI_TIER: "free",
        DEMO_MODE: "false",
      }),
    ).rejects.toThrow(/AI_TIER="free" cannot be used in production/);
  });

  it("allows the free AI tier when it is on", async () => {
    const env = await boot({
      PAYMENT_PROVIDER: "fake",
      AI_ASSISTANT_ENABLED: "true",
      GOOGLE_GENERATIVE_AI_API_KEY: "key",
      AI_TIER: "free",
      DEMO_MODE: "true",
    });
    expect(env.AI_TIER).toBe("free");
  });

  it("still refuses the log email driver — it loses mail instead of failing", async () => {
    await expect(
      boot({ PAYMENT_PROVIDER: "fake", DEMO_MODE: "true", EMAIL_DRIVER: "log" }),
    ).rejects.toThrow(/EMAIL_DRIVER="log" cannot be used in production/);
  });

  it("still refuses the local image store — uploads would 404 next request", async () => {
    await expect(
      boot({ PAYMENT_PROVIDER: "fake", DEMO_MODE: "true", IMAGE_STORE: "local" }),
    ).rejects.toThrow(/IMAGE_STORE="local" cannot be used in production/);
  });

  it("still requires the shared Redis store — an unenforced rate limit is silent", async () => {
    await expect(
      boot({
        PAYMENT_PROVIDER: "fake",
        DEMO_MODE: "true",
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
      }),
    ).rejects.toThrow(/Missing required production environment/);
  });

  it("defaults to off, so nothing above changes for a normal deployment", async () => {
    const env = await boot({
      PAYMENT_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk",
      STRIPE_WEBHOOK_SECRET: "whsec",
      DEMO_MODE: "",
    });
    expect(env.DEMO_MODE).toBe(false);
  });
});
