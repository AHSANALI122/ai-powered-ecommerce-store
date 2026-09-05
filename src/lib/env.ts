import { z } from "zod";

/**
 * Server-only environment. Parsed once at import time so a misconfigured
 * deployment fails at boot rather than on the first request (SEC-12).
 *
 * Set SKIP_ENV_VALIDATION=1 for builds that legitimately have no secrets
 * available (CI typecheck/build, Docker image builds).
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  SHADOW_DATABASE_URL: z.url().optional(),

  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  AUTH_SECRET: z.string().min(32).optional(),

  BASE_CURRENCY: z.string().length(3).default("PKR"),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- Checkout (F3) -------------------------------------------------------
  /** How long an unpaid PENDING order stays payable before the cron expires it. */
  ORDER_EXPIRY_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  /** Which PaymentProvider a checkout is routed to. */
  PAYMENT_PROVIDER: z.enum(["easypaisa", "stripe", "fake"]).default("fake"),
  /** Bearer secret the order-expiry cron must present. */
  CRON_SECRET: z.string().min(16).optional(),

  EASYPAISA_STORE_ID: z.string().min(1).optional(),
  /** 16-character AES key; also the shared secret the IPN hash is checked with. */
  EASYPAISA_HASH_KEY: z.string().min(1).optional(),
  EASYPAISA_USERNAME: z.string().min(1).optional(),
  EASYPAISA_PASSWORD: z.string().min(1).optional(),
  EASYPAISA_ACCOUNT_NUM: z.string().min(1).optional(),
  EASYPAISA_CHECKOUT_URL: z
    .url()
    .default("https://easypay.easypaisa.com.pk/easypay/Index.jsf"),
  EASYPAISA_INQUIRY_URL: z
    .url()
    .default(
      "https://easypay.easypaisa.com.pk/easypay-service/rest/v4/inquire-transaction",
    ),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // --- Admin image upload (F4, SEC-14) -------------------------------------
  /**
   * Where an admin-uploaded image is written. `local` writes under the repo's
   * public directory, which only exists on a development machine — a Vercel
   * filesystem is read-only and per-instance — so boot refuses it in
   * production, exactly as it refuses `PAYMENT_PROVIDER=fake`.
   */
  IMAGE_STORE: z.enum(["local", "blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  /** Hard ceiling on an uploaded image, in bytes. Enforced twice: header, then bytes. */
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),

  PEXELS_API_KEY: z.string().min(1).optional(),

  APP_URL: z.url().default("http://localhost:3000"),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1).default("Atlas & Co."),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * A variable present but empty in a .env file (`AUTH_SECRET=""`) means "not
 * configured", not "configured as an empty string". Without this, every
 * optional key copied from .env.example fails validation.
 */
function withoutEmptyStrings(source: NodeJS.ProcessEnv): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() === "") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * `next build` runs with NODE_ENV=production, but a build is not a boot: it has
 * no business demanding the runtime secrets of a deployed server. Production
 * requirements are enforced when actually serving, and by getRedis() at the
 * point of use.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Credentials the configured payment provider cannot run without. Checked at
 * boot rather than at the first checkout, so a misconfigured deploy fails
 * before a shopper meets it.
 */
function missingProviderCredentials(env: ServerEnv): string[] {
  const missing: string[] = [];
  if (env.PAYMENT_PROVIDER === "easypaisa") {
    if (!env.EASYPAISA_STORE_ID) missing.push("EASYPAISA_STORE_ID");
    if (!env.EASYPAISA_HASH_KEY) missing.push("EASYPAISA_HASH_KEY");
    if (!env.EASYPAISA_USERNAME) missing.push("EASYPAISA_USERNAME");
    if (!env.EASYPAISA_PASSWORD) missing.push("EASYPAISA_PASSWORD");
  }
  if (env.PAYMENT_PROVIDER === "stripe") {
    if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
    if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  }
  return missing;
}

function loadServerEnv(): ServerEnv {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    // Values are still shaped correctly for type-checking; nothing here is used
    // at runtime because the process is only building, not serving.
    return serverSchema.parse({
      NODE_ENV: process.env.NODE_ENV ?? "development",
      DATABASE_URL: "postgresql://build:build@localhost:5432/build",
      BASE_CURRENCY: process.env.BASE_CURRENCY ?? "PKR",
      TAX_RATE: process.env.TAX_RATE ?? "0",
    });
  }

  const parsed = serverSchema.safeParse(withoutEmptyStrings(process.env));
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment:\n${formatIssues(parsed.error)}\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  // Production requires the shared state store; without it every rate limit and
  // idempotency check silently degrades to a no-op across Vercel instances
  // (SEC-18).
  if (parsed.data.NODE_ENV === "production" && !isBuildPhase()) {
    const missing: string[] = [];
    if (!parsed.data.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
    if (!parsed.data.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
    if (!parsed.data.AUTH_SECRET) missing.push("AUTH_SECRET");
    if (missing.length > 0) {
      throw new Error(`Missing required production environment: ${missing.join(", ")}`);
    }

    // A production deploy that can take money must be able to prove a payment
    // (AD-8). The fake provider marks orders paid on an unsigned local request,
    // so it is a development affordance and never a production one.
    if (parsed.data.PAYMENT_PROVIDER === "fake") {
      throw new Error(
        'PAYMENT_PROVIDER="fake" cannot be used in production: it accepts unverified payments.',
      );
    }
    const providerMissing = missingProviderCredentials(parsed.data);
    if (providerMissing.length > 0) {
      throw new Error(
        `PAYMENT_PROVIDER="${parsed.data.PAYMENT_PROVIDER}" is missing: ${providerMissing.join(", ")}`,
      );
    }

    // The local image store writes to the deployment's own filesystem, which
    // on Vercel is read-only and not shared between instances. An upload that
    // "succeeds" there is a product image that 404s from the next request on.
    if (parsed.data.IMAGE_STORE === "local") {
      throw new Error(
        'IMAGE_STORE="local" cannot be used in production: the filesystem is read-only and per-instance. Set IMAGE_STORE="blob".',
      );
    }
    if (parsed.data.IMAGE_STORE === "blob" && !parsed.data.BLOB_READ_WRITE_TOKEN) {
      throw new Error('IMAGE_STORE="blob" is missing: BLOB_READ_WRITE_TOKEN');
    }
  }

  return parsed.data;
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Server environment accessor. Throws if reached from browser code, which is
 * the failure mode that leaks secrets into a client bundle.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser. This module is server-only.");
  }
  cachedServerEnv ??= loadServerEnv();
  return cachedServerEnv;
}

/**
 * Public environment. Safe in both runtimes. Next.js inlines NEXT_PUBLIC_ vars
 * at build time, so they must be referenced by their full literal name.
 */
export const publicEnv: PublicEnv = publicSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
});

export function isProduction(): boolean {
  return serverEnv().NODE_ENV === "production";
}
