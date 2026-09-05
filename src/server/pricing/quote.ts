import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { add, gte, money, mul, sub, sum, toStorage, type MoneyInput } from "@/lib/money";
import { getTaxRate } from "@/server/pricing/settings";

/**
 * Quoting (SEC-4, SEC-11).
 *
 * `computeTotals` is pure: given lines, a shipping rate and a tax rate it
 * returns the whole breakdown and touches nothing. That is what makes the
 * boundary conditions — a `freeOver` threshold hit exactly, a zero-rate tax, a
 * cart with no shippable lines — unit-testable rather than only reachable
 * through a checkout.
 *
 * Everything above it reads from the database. No amount in this module comes
 * from a request: the client picks an address and a shipping rate by id, and
 * the price attached to those ids is looked up here.
 */

export interface QuoteLine {
  unitPrice: MoneyInput;
  quantity: number;
}

export interface QuoteTotals {
  currency: string;
  subtotal: string;
  shippingTotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  /** True when `freeOver` zeroed the shipping charge — worth saying in the UI. */
  shippingWaived: boolean;
}

export interface ShippingChoice {
  price: MoneyInput;
  /** Subtotal at or above which shipping is free. Null disables the waiver. */
  freeOver: MoneyInput | null;
}

/**
 * Rounding happens once per computed total, never per intermediate (money.ts).
 * Tax applies to the merchandise subtotal only — shipping is not taxed. That
 * is the MVP rule from the spec's "single flat configurable rate"; a
 * jurisdiction that taxes freight needs a per-country rule, not a tweak here.
 */
export function computeTotals(params: {
  lines: readonly QuoteLine[];
  shipping: ShippingChoice | null;
  taxRate: MoneyInput;
  currency: string;
  discountTotal?: MoneyInput;
}): QuoteTotals {
  const subtotal = money(
    toStorage(sum(params.lines.map((line) => mul(line.unitPrice, line.quantity)))),
  );

  const waived =
    params.shipping?.freeOver != null && gte(subtotal, params.shipping.freeOver);

  const shippingTotal = money(
    toStorage(!params.shipping || waived ? 0 : params.shipping.price),
  );

  const taxTotal = money(toStorage(mul(subtotal, params.taxRate)));
  const discountTotal = money(toStorage(params.discountTotal ?? 0));

  const grandTotal = sub(add(add(subtotal, shippingTotal), taxTotal), discountTotal);

  return {
    currency: params.currency,
    subtotal: toStorage(subtotal),
    shippingTotal: toStorage(shippingTotal),
    taxTotal: toStorage(taxTotal),
    discountTotal: toStorage(discountTotal),
    // Clamped: a discount larger than the order must never produce a negative
    // charge, which some providers accept as a refund.
    grandTotal: toStorage(grandTotal.isNegative() ? 0 : grandTotal),
    shippingWaived: Boolean(waived),
  };
}

// ---------------------------------------------------------------------------
// Shipping zones
// ---------------------------------------------------------------------------

export interface ShippingOption {
  id: string;
  name: string;
  zoneName: string;
  price: string;
  freeOver: string | null;
  minDays: number;
  maxDays: number;
}

export const CATCH_ALL_COUNTRY = "*";

/**
 * Zone resolution: the most specific match wins. An explicit zone listing the
 * destination country beats the `["*"]` catch-all, which is consulted only
 * when no explicit zone claims the country.
 *
 * The `["*"]` row is excluded from the explicit query rather than filtered
 * afterwards, so a zone that lists both `"*"` and real countries cannot
 * shadow a specific zone by accident.
 */
export async function listShippingOptions(country: string): Promise<ShippingOption[]> {
  const code = country.trim().toUpperCase();

  const explicit = await prisma.shippingZone.findFirst({
    where: { isActive: true, countries: { has: code } },
    orderBy: { position: "asc" },
    select: { name: true, rates: { where: { isActive: true } } },
  });

  const zone =
    explicit ??
    (await prisma.shippingZone.findFirst({
      where: { isActive: true, countries: { has: CATCH_ALL_COUNTRY } },
      orderBy: { position: "asc" },
      select: { name: true, rates: { where: { isActive: true } } },
    }));

  if (!zone) return [];

  return zone.rates
    .map((rate) => ({
      id: rate.id,
      name: rate.name,
      zoneName: zone.name,
      price: toStorage(rate.price.toString()),
      freeOver: rate.freeOver ? toStorage(rate.freeOver.toString()) : null,
      minDays: rate.minDays,
      maxDays: rate.maxDays,
    }))
    .sort((a, b) => Number(a.price) - Number(b.price));
}

// ---------------------------------------------------------------------------
// Full quote
// ---------------------------------------------------------------------------

export interface Quote extends QuoteTotals {
  shipping: ShippingOption | null;
  options: ShippingOption[];
  taxRate: string;
}

/**
 * The quote a checkout screen renders and the checkout endpoint recomputes.
 * Both call this, so the number a shopper is shown and the number that reaches
 * the payment provider are produced by the same code path.
 */
export async function buildQuote(params: {
  lines: readonly QuoteLine[];
  country: string;
  shippingRateId?: string | undefined;
}): Promise<Quote> {
  const [options, taxRate] = await Promise.all([
    listShippingOptions(params.country),
    getTaxRate(),
  ]);

  // The chosen rate must be one the *destination* is entitled to. Looking it
  // up inside the zone's own option list — rather than by id alone — is what
  // stops a client pricing the cheap domestic rate against an overseas
  // address by sending its id (SEC-4). An unrecognised id yields no shipping,
  // and checkout refuses rather than guessing.
  const shipping = params.shippingRateId
    ? (options.find((option) => option.id === params.shippingRateId) ?? null)
    : (options[0] ?? null);

  const totals = computeTotals({
    lines: params.lines,
    shipping,
    taxRate,
    currency: serverEnv().BASE_CURRENCY,
  });

  return { ...totals, shipping, options, taxRate: taxRate.toString() };
}
