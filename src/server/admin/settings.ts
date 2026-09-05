import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { TAX_RATE_SETTING_KEY } from "@/server/pricing/settings";

/**
 * Runtime settings administration (F4).
 *
 * Only the tax rate for now, and the write side is deliberately thin: this
 * writes a `Setting` row that `getTaxRate()` prefers over the `TAX_RATE` env
 * default, so a rate change takes effect on the next quote without a redeploy.
 *
 * There is no cache to invalidate here, and that is the point. `getTaxRate` is
 * wrapped in React `cache()` — per-request memoisation — rather than
 * `unstable_cache`, precisely so a rate can never outlive the change that
 * raised it and be applied to a real charge (SEC-11).
 */

export interface TaxRateView {
  /** The rate in force, as a decimal fraction string. */
  rate: string;
  /** Where it came from, so the screen can say "still on the env default". */
  source: "setting" | "env";
  envDefault: string;
  updatedAt: Date | null;
}

export async function readTaxRateSetting(): Promise<TaxRateView> {
  const envDefault = serverEnv().TAX_RATE.toString();
  const setting = await prisma.setting.findUnique({
    where: { key: TAX_RATE_SETTING_KEY },
    select: { value: true, updatedAt: true },
  });

  const stored = readStoredRate(setting?.value);
  if (stored === null) {
    return { rate: envDefault, source: "env", envDefault, updatedAt: null };
  }
  return {
    rate: stored,
    source: "setting",
    envDefault,
    updatedAt: setting?.updatedAt ?? null,
  };
}

/** Mirrors the shapes `parseRate` in pricing/settings.ts accepts. */
function readStoredRate(value: unknown): string | null {
  const raw =
    typeof value === "object" && value !== null && "value" in value
      ? (value as { value: unknown }).value
      : value;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return raw.toString();
  return null;
}

/**
 * Stored as `{ value: "0.18" }` — a string, not a float. The reader accepts
 * either, but writing a JSON number would put a tax rate through a binary
 * float on its way to and from the database, which is exactly what AD-6
 * exists to prevent.
 */
export async function writeTaxRateSetting(rate: string): Promise<TaxRateView> {
  await prisma.setting.upsert({
    where: { key: TAX_RATE_SETTING_KEY },
    create: { key: TAX_RATE_SETTING_KEY, value: { value: rate } },
    update: { value: { value: rate } },
  });
  return readTaxRateSetting();
}
