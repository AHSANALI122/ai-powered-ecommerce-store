import { describe, expect, it } from "vitest";
import { computeTotals } from "@/server/pricing/quote";

/**
 * `computeTotals` is the pure core of checkout pricing. Everything a shopper is
 * charged passes through it, so the cases below are the ones where being a
 * cent out is a real defect: the `freeOver` boundary, tax rounding, and a
 * discount that would otherwise produce a negative charge.
 */

const PKR = "PKR";

describe("computeTotals", () => {
  it("sums lines with decimal precision, not floating point", () => {
    const totals = computeTotals({
      lines: [
        { unitPrice: "0.10", quantity: 1 },
        { unitPrice: "0.20", quantity: 1 },
      ],
      shipping: null,
      taxRate: 0,
      currency: PKR,
    });

    // 0.1 + 0.2 !== 0.3 in binary floating point. It must here.
    expect(totals.subtotal).toBe("0.30");
    expect(totals.grandTotal).toBe("0.30");
  });

  it("multiplies unit price by quantity", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "1999.99", quantity: 3 }],
      shipping: null,
      taxRate: 0,
      currency: PKR,
    });

    expect(totals.subtotal).toBe("5999.97");
  });

  it("charges shipping when the subtotal is below freeOver", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "7999.99", quantity: 1 }],
      shipping: { price: "350.00", freeOver: "8000.00" },
      taxRate: 0,
      currency: PKR,
    });

    expect(totals.shippingTotal).toBe("350.00");
    expect(totals.shippingWaived).toBe(false);
    expect(totals.grandTotal).toBe("8349.99");
  });

  it("waives shipping exactly at the freeOver threshold", () => {
    // The boundary is inclusive: "free over 8000" means 8000 qualifies. An
    // off-by-one here is a customer-service ticket, every time.
    const totals = computeTotals({
      lines: [{ unitPrice: "8000.00", quantity: 1 }],
      shipping: { price: "350.00", freeOver: "8000.00" },
      taxRate: 0,
      currency: PKR,
    });

    expect(totals.shippingTotal).toBe("0.00");
    expect(totals.shippingWaived).toBe(true);
    expect(totals.grandTotal).toBe("8000.00");
  });

  it("never waives shipping when freeOver is null", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "999999.00", quantity: 1 }],
      shipping: { price: "900.00", freeOver: null },
      taxRate: 0,
      currency: PKR,
    });

    expect(totals.shippingTotal).toBe("900.00");
    expect(totals.shippingWaived).toBe(false);
  });

  it("charges no shipping when no rate could be resolved", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "100.00", quantity: 1 }],
      shipping: null,
      taxRate: 0,
      currency: PKR,
    });

    expect(totals.shippingTotal).toBe("0.00");
  });

  it("taxes the merchandise subtotal, not the shipping", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "1000.00", quantity: 1 }],
      shipping: { price: "350.00", freeOver: null },
      taxRate: "0.18",
      currency: PKR,
    });

    expect(totals.taxTotal).toBe("180.00");
    expect(totals.grandTotal).toBe("1530.00");
  });

  it("rounds tax half-up to two decimals", () => {
    // 33.33 * 0.175 = 5.83275 -> 5.83
    const totals = computeTotals({
      lines: [{ unitPrice: "33.33", quantity: 1 }],
      shipping: null,
      taxRate: "0.175",
      currency: PKR,
    });

    expect(totals.taxTotal).toBe("5.83");
    expect(totals.grandTotal).toBe("39.16");
  });

  it("rounds a half exactly away from zero", () => {
    // 10.00 * 0.125 = 1.25 -> 1.25; 10.10 * 0.125 = 1.2625 -> 1.26
    const totals = computeTotals({
      lines: [{ unitPrice: "10.10", quantity: 1 }],
      shipping: null,
      taxRate: "0.125",
      currency: PKR,
    });

    expect(totals.taxTotal).toBe("1.26");
  });

  it("subtracts a discount", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "1000.00", quantity: 1 }],
      shipping: { price: "100.00", freeOver: null },
      taxRate: 0,
      currency: PKR,
      discountTotal: "250.00",
    });

    expect(totals.discountTotal).toBe("250.00");
    expect(totals.grandTotal).toBe("850.00");
  });

  it("clamps a grand total that a discount would drive negative", () => {
    // A negative amount is a refund instruction to some providers. It must
    // never be possible to reach one through the pricing path.
    const totals = computeTotals({
      lines: [{ unitPrice: "100.00", quantity: 1 }],
      shipping: null,
      taxRate: 0,
      currency: PKR,
      discountTotal: "500.00",
    });

    expect(totals.grandTotal).toBe("0.00");
  });

  it("returns zeroes for an empty cart rather than throwing", () => {
    const totals = computeTotals({
      lines: [],
      shipping: { price: "350.00", freeOver: "8000.00" },
      taxRate: "0.18",
      currency: PKR,
    });

    expect(totals.subtotal).toBe("0.00");
    expect(totals.taxTotal).toBe("0.00");
    // No merchandise, but a rate was chosen, so its price still applies.
    expect(totals.shippingTotal).toBe("350.00");
  });

  it("reports the currency it was given", () => {
    const totals = computeTotals({
      lines: [{ unitPrice: "1.00", quantity: 1 }],
      shipping: null,
      taxRate: 0,
      currency: "USD",
    });

    expect(totals.currency).toBe("USD");
  });
});
