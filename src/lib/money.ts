import Decimal from "decimal.js";

/**
 * Money arithmetic (AD-6). Every price, subtotal and total in the system flows
 * through here — a JS `number` must never touch a monetary value, because
 * 0.1 + 0.2 !== 0.3 and a cent of drift becomes a mismatched charge.
 *
 * Prisma returns Decimal-compatible values for `@db.Decimal` columns and
 * accepts strings on write, so this module deliberately does not import the
 * generated client: it stays testable without running codegen.
 */

/** Local Decimal configuration; does not mutate the global Decimal settings. */
const D = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -12,
  toExpPos: 24,
});

export type MoneyInput = string | number | Decimal | { toString(): string };

/** Minor units per major unit. PKR, USD, EUR and friends are all 2. */
const DEFAULT_SCALE = 2;

export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return new D(value.toString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Cannot build money from non-finite number: ${value}`);
    }
    // Route through a string so the binary float is never interpreted directly.
    return new D(value.toString());
  }
  return new D(value.toString());
}

export const ZERO: Decimal = money(0);

export function add(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).plus(money(b));
}

export function sub(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

/** Multiply a price by a quantity or a rate. */
export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, value) => acc.plus(money(value)), money(0));
}

/**
 * Round to the currency's minor unit, half-up. This is the single rounding rule
 * for the system: apply it once per computed total, never per intermediate.
 */
export function round(value: MoneyInput, scale: number = DEFAULT_SCALE): Decimal {
  return money(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative();
}

export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gte(money(b));
}

export function eq(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).eq(money(b));
}

/**
 * Convert to the integer minor units that payment providers expect (Stripe
 * `amount`, Easypaisa `amount`). Only cross this boundary at the provider edge.
 */
export function toMinorUnits(value: MoneyInput, scale: number = DEFAULT_SCALE): number {
  const rounded = round(value, scale);
  const minor = rounded.times(new D(10).pow(scale));
  if (!minor.isInteger()) {
    throw new RangeError(`Amount ${rounded.toString()} does not fit ${scale} decimals`);
  }
  const asNumber = minor.toNumber();
  if (!Number.isSafeInteger(asNumber)) {
    throw new RangeError(`Amount ${rounded.toString()} exceeds safe integer range`);
  }
  return asNumber;
}

export function fromMinorUnits(minor: number, scale: number = DEFAULT_SCALE): Decimal {
  return money(minor).dividedBy(new D(10).pow(scale));
}

/** Canonical string for persistence: fixed scale, no exponent notation. */
export function toStorage(value: MoneyInput, scale: number = DEFAULT_SCALE): string {
  return round(value, scale).toFixed(scale);
}

export function formatMoney(
  value: MoneyInput,
  currency: string,
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: DEFAULT_SCALE,
  }).format(Number(round(value).toFixed(DEFAULT_SCALE)));
}

export { Decimal };
