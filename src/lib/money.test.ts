import { describe, expect, it } from "vitest";
import {
  add,
  formatMoney,
  fromMinorUnits,
  money,
  mul,
  round,
  sub,
  sum,
  toMinorUnits,
  toStorage,
} from "@/lib/money";

describe("money", () => {
  it("adds without binary float drift", () => {
    // The canonical reason prices are never `number`.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(add("0.10", "0.20").toString()).toBe("0.3");
  });

  it("keeps precision across a long running total", () => {
    const lines = Array.from({ length: 1000 }, () => "0.07");
    expect(sum(lines).toString()).toBe("70");
  });

  it("multiplies a price by a quantity exactly", () => {
    expect(mul("19.99", 3).toString()).toBe("59.97");
  });

  it("subtracts exactly", () => {
    expect(sub("100.00", "33.33").toString()).toBe("66.67");
  });
});

describe("round", () => {
  it("rounds half away from zero", () => {
    expect(round("2.345").toString()).toBe("2.35");
    expect(round("2.344").toString()).toBe("2.34");
    // Half-up, not banker's rounding: 2.5 -> 3, never 2.
    expect(round("0.125").toString()).toBe("0.13");
    expect(round("0.135").toString()).toBe("0.14");
  });

  it("is idempotent", () => {
    const once = round("10.005");
    expect(round(once).toString()).toBe(once.toString());
  });
});

describe("minor units", () => {
  it("converts to the integer amount providers expect", () => {
    expect(toMinorUnits("19.99")).toBe(1999);
    expect(toMinorUnits("0.01")).toBe(1);
    expect(toMinorUnits(2490)).toBe(249000);
  });

  it("rounds before converting rather than throwing on sub-cent input", () => {
    expect(toMinorUnits("19.994")).toBe(1999);
    expect(toMinorUnits("19.995")).toBe(2000);
  });

  it("round-trips", () => {
    expect(fromMinorUnits(toMinorUnits("123.45")).toString()).toBe("123.45");
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => toMinorUnits("999999999999999999")).toThrow(RangeError);
  });
});

describe("storage", () => {
  it("always writes a fixed two-decimal string", () => {
    expect(toStorage("7")).toBe("7.00");
    expect(toStorage("7.1")).toBe("7.10");
    expect(toStorage("7.006")).toBe("7.01");
  });
});

describe("money()", () => {
  it("accepts Prisma-style Decimal-ish objects via toString", () => {
    const prismaLike = { toString: () => "42.50" };
    expect(money(prismaLike).toString()).toBe("42.5");
  });

  it("rejects non-finite numbers rather than producing NaN totals", () => {
    expect(() => money(Number.NaN)).toThrow(TypeError);
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("formatMoney", () => {
  it("formats the base currency", () => {
    expect(formatMoney("2490", "PKR")).toContain("2,490.00");
  });
});
