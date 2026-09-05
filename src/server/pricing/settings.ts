import { cache } from "react";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { money, type Decimal } from "@/lib/money";

/**
 * Runtime-tunable pricing settings.
 *
 * The flat tax rate has two sources, in order: a `Setting` row keyed
 * `tax.rate`, and the `TAX_RATE` env default behind it. That ordering is what
 * lets F4's admin change the rate without a redeploy while a fresh database
 * still boots with a sane value.
 *
 * Wrapped in React `cache()` so a checkout page that quotes three times issues
 * one query. It is deliberately *not* `unstable_cache`: a tax rate read from a
 * cross-request cache could outlive the change that raised it, and be applied
 * to a real charge.
 */

export const TAX_RATE_SETTING_KEY = "tax.rate";

/** Accepts `0.18`, `"0.18"`, or `{ "value": "0.18" }` in the JSON column. */
function parseRate(value: unknown): Decimal | null {
  const raw =
    typeof value === "object" && value !== null && "value" in value
      ? (value as { value: unknown }).value
      : value;

  if (typeof raw !== "string" && typeof raw !== "number") return null;

  try {
    const rate = money(raw);
    // A rate outside [0, 1] is a data-entry error, not a tax policy. Falling
    // back beats charging 1800% tax because someone typed 18 instead of 0.18.
    if (rate.isNegative() || rate.greaterThan(1)) return null;
    return rate;
  } catch {
    return null;
  }
}

export const getTaxRate = cache(async (): Promise<Decimal> => {
  const fallback = money(serverEnv().TAX_RATE);

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: TAX_RATE_SETTING_KEY },
      select: { value: true },
    });
    return (setting && parseRate(setting.value)) ?? fallback;
  } catch (error) {
    console.error("[pricing] tax rate lookup failed; using TAX_RATE", error);
    return fallback;
  }
});
