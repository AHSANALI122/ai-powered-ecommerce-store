import { describe, expect, it } from "vitest";
import { addCartItemSchema, updateCartItemSchema } from "@/lib/validation/cart";
import {
  checkoutSchema,
  idempotencyKeySchema,
  quoteRequestSchema,
} from "@/lib/validation/checkout";
import { addressInputSchema, addressUpdateSchema } from "@/lib/validation/address";

/**
 * These schemas are the boundary the price-integrity rule is enforced at
 * (SEC-4, SEC-16). The tests that matter most are the negative ones: a body
 * carrying a price must be *rejected*, not quietly stripped, because a schema
 * that ignores unknown fields leaves every handler responsible for remembering
 * not to trust them.
 */

describe("addCartItemSchema", () => {
  it("accepts a variant and a quantity", () => {
    const parsed = addCartItemSchema.parse({ variantId: "v1", quantity: 2 });
    expect(parsed).toEqual({ variantId: "v1", quantity: 2 });
  });

  it("defaults the quantity to one", () => {
    expect(addCartItemSchema.parse({ variantId: "v1" }).quantity).toBe(1);
  });

  it("rejects a smuggled price", () => {
    expect(
      addCartItemSchema.safeParse({ variantId: "v1", quantity: 1, price: "0.01" })
        .success,
    ).toBe(false);
  });

  it("rejects a quantity above the per-line cap", () => {
    expect(addCartItemSchema.safeParse({ variantId: "v1", quantity: 999 }).success).toBe(
      false,
    );
  });

  it("rejects zero, negative and fractional quantities", () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(addCartItemSchema.safeParse({ variantId: "v1", quantity }).success).toBe(
        false,
      );
    }
  });
});

describe("updateCartItemSchema", () => {
  it("rejects a quantity of zero — removal is a DELETE", () => {
    expect(updateCartItemSchema.safeParse({ quantity: 0 }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  it("accepts an address and a shipping rate", () => {
    expect(checkoutSchema.parse({ addressId: "a1", shippingRateId: "r1" })).toEqual({
      addressId: "a1",
      shippingRateId: "r1",
    });
  });

  it("rejects client-supplied totals", () => {
    // The whole point of SEC-4 expressed as a test.
    for (const extra of [
      { grandTotal: "1.00" },
      { subtotal: "1.00" },
      { shippingTotal: "0.00" },
      { taxTotal: "0.00" },
      { currency: "USD" },
    ]) {
      expect(
        checkoutSchema.safeParse({
          addressId: "a1",
          shippingRateId: "r1",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("requires a shipping rate, unlike a quote request", () => {
    expect(checkoutSchema.safeParse({ addressId: "a1" }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ addressId: "a1" }).success).toBe(true);
  });
});

describe("idempotencyKeySchema", () => {
  it("accepts a UUID", () => {
    expect(
      idempotencyKeySchema.safeParse("3f2504e0-4f89-11d3-9a0c-0305e82c3301").success,
    ).toBe(true);
  });

  it("rejects a key too short to be unguessable", () => {
    expect(idempotencyKeySchema.safeParse("abc").success).toBe(false);
  });

  it("rejects characters that are not URL-safe", () => {
    expect(idempotencyKeySchema.safeParse("key with spaces!!").success).toBe(false);
  });

  it("rejects a missing header value", () => {
    expect(idempotencyKeySchema.safeParse(null).success).toBe(false);
  });
});

describe("addressInputSchema", () => {
  const valid = {
    fullName: "A Shopper",
    line1: "1 Example Road",
    city: "Karachi",
    country: "pk",
  };

  it("uppercases the country code so zone matching is unambiguous", () => {
    // "pk" and "PK" must not resolve to different shipping zones, and
    // therefore different shipping charges.
    expect(addressInputSchema.parse(valid).country).toBe("PK");
  });

  it("rejects a country that is not two letters", () => {
    for (const country of ["PAK", "P", "12"]) {
      expect(addressInputSchema.safeParse({ ...valid, country }).success).toBe(false);
    }
  });

  it("rejects a userId in the body", () => {
    // Ownership comes from the session; there must be nothing to point at
    // somebody else's account (SEC-23).
    expect(addressInputSchema.safeParse({ ...valid, userId: "u2" }).success).toBe(false);
  });

  it("defaults isDefault to false", () => {
    expect(addressInputSchema.parse(valid).isDefault).toBe(false);
  });
});

describe("addressUpdateSchema", () => {
  it("accepts a partial update", () => {
    expect(addressUpdateSchema.safeParse({ city: "Lahore" }).success).toBe(true);
  });

  it("rejects an empty update", () => {
    expect(addressUpdateSchema.safeParse({}).success).toBe(false);
  });
});
