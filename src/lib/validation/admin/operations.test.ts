import { describe, expect, it } from "vitest";
import {
  orderStatusUpdateSchema,
  reviewModerationSchema,
  shippingRateCreateSchema,
  shippingZoneCreateSchema,
  taxRateUpdateSchema,
} from "@/lib/validation/admin/operations";

describe("orderStatusUpdateSchema", () => {
  it.each(["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"])(
    "accepts the operator transition %s",
    (status) => {
      expect(orderStatusUpdateSchema.safeParse({ status }).success).toBe(true);
    },
  );

  it.each(["PENDING", "EXPIRED"])(
    "rejects %s, which is a state the system assigns rather than a destination",
    (status) => {
      expect(orderStatusUpdateSchema.safeParse({ status }).success).toBe(false);
    },
  );

  /**
   * The important negative: PAID is set by a verified provider callback and by
   * nothing else (SEC-6, AD-8). There is no field here that can ask for it, so
   * a hand-rolled request has no vocabulary for claiming money arrived.
   */
  it.each(["paymentStatus", "paidAt", "grandTotal", "refundRef", "providerRef"])(
    "rejects a body carrying %s",
    (field) => {
      const result = orderStatusUpdateSchema.safeParse({
        status: "SHIPPED",
        [field]: "PAID",
      });
      expect(result.success).toBe(false);
    },
  );
});

describe("reviewModerationSchema", () => {
  it("accepts a verdict", () => {
    expect(reviewModerationSchema.safeParse({ status: "APPROVED" }).success).toBe(true);
  });

  it("rejects an attempt to rewrite the rating along with the verdict", () => {
    const result = reviewModerationSchema.safeParse({ status: "APPROVED", rating: 5 });
    expect(result.success).toBe(false);
  });
});

describe("taxRateUpdateSchema", () => {
  it.each(["0", "0.18", "0.005", "1", 0.18])("accepts the fraction %s", (rate) => {
    expect(taxRateUpdateSchema.safeParse({ rate }).success).toBe(true);
  });

  /**
   * The one-keystroke mistake this exists for: `18` means 1800%, not 18%.
   */
  it.each(["18", "1.5", "-0.1", "100", "abc"])("rejects %s", (rate) => {
    expect(taxRateUpdateSchema.safeParse({ rate }).success).toBe(false);
  });
});

describe("shippingZoneCreateSchema", () => {
  it("uppercases country codes so PK and pk cannot resolve to different zones", () => {
    const parsed = shippingZoneCreateSchema.parse({
      name: "Gulf",
      countries: ["pk", "ae"],
    });
    expect(parsed.countries).toEqual(["PK", "AE"]);
  });

  it("de-duplicates a repeated country", () => {
    const parsed = shippingZoneCreateSchema.parse({
      name: "Gulf",
      countries: ["PK", "pk"],
    });
    expect(parsed.countries).toEqual(["PK"]);
  });

  it("accepts the catch-all on its own", () => {
    expect(
      shippingZoneCreateSchema.safeParse({ name: "Rest of world", countries: ["*"] })
        .success,
    ).toBe(true);
  });

  it("rejects the catch-all mixed with explicit countries", () => {
    // A zone that is both "everywhere" and "these two" has no coherent
    // matching order against the other zones.
    expect(
      shippingZoneCreateSchema.safeParse({ name: "Odd", countries: ["*", "PK"] }).success,
    ).toBe(false);
  });

  it.each([["PAK"], ["P"], ["12"], [""]])("rejects the country code %s", (code) => {
    expect(
      shippingZoneCreateSchema.safeParse({ name: "Zone", countries: [code] }).success,
    ).toBe(false);
  });
});

describe("shippingRateCreateSchema", () => {
  const base = { zoneId: "zone_1", name: "Standard", price: "350.00" };

  it("accepts a sane rate", () => {
    expect(shippingRateCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a delivery window that ends before it starts", () => {
    const result = shippingRateCreateSchema.safeParse({
      ...base,
      minDays: 10,
      maxDays: 3,
    });
    expect(result.success).toBe(false);
  });

  it("treats a null freeOver as 'never free' rather than 'free over zero'", () => {
    const parsed = shippingRateCreateSchema.parse({ ...base, freeOver: null });
    expect(parsed.freeOver).toBeNull();
  });
});
