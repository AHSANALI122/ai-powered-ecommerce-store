import { describe, expect, it } from "vitest";
import { addWishlistItemSchema, moveToCartSchema } from "@/lib/validation/wishlist";
import { MAX_LINE_QUANTITY } from "@/lib/validation/cart";

/**
 * The wishlist input boundary (SEC-16, SEC-23).
 *
 * One rule, asserted from several directions: nothing crossing this boundary
 * may name a user. Ownership comes from the session in the route handler, and
 * a schema with no `userId` is what makes "aim this at somebody else's list"
 * an unrepresentable request rather than a check someone must remember.
 */

describe("addWishlistItemSchema", () => {
  it("accepts a product id and nothing else", () => {
    expect(addWishlistItemSchema.safeParse({ productId: "prod_123" }).success).toBe(true);
  });

  it("rejects a client-named owner", () => {
    expect(
      addWishlistItemSchema.safeParse({ productId: "prod_123", userId: "usr_other" })
        .success,
    ).toBe(false);
  });

  it("requires a product id", () => {
    expect(addWishlistItemSchema.safeParse({}).success).toBe(false);
    expect(addWishlistItemSchema.safeParse({ productId: "" }).success).toBe(false);
  });
});

describe("moveToCartSchema", () => {
  it("defaults the quantity to one", () => {
    const result = moveToCartSchema.safeParse({ productId: "prod_123" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(1);
  });

  it("carries no price", () => {
    // Same rule as the cart's own schema (SEC-4): the server reads the price
    // from the database and there is no field here to disagree with it.
    expect(
      moveToCartSchema.safeParse({ productId: "prod_123", price: "1.00" }).success,
    ).toBe(false);
    expect(
      moveToCartSchema.safeParse({ productId: "prod_123", unitPrice: 1 }).success,
    ).toBe(false);
  });

  it("shares the cart's quantity ceiling", () => {
    expect(
      moveToCartSchema.safeParse({ productId: "prod_123", quantity: MAX_LINE_QUANTITY })
        .success,
    ).toBe(true);
    expect(
      moveToCartSchema.safeParse({
        productId: "prod_123",
        quantity: MAX_LINE_QUANTITY + 1,
      }).success,
    ).toBe(false);
    expect(
      moveToCartSchema.safeParse({ productId: "prod_123", quantity: 0 }).success,
    ).toBe(false);
  });

  it("allows an optional variant, which the server still verifies", () => {
    // Accepting the id is not trusting it: the service looks it up with the
    // product id in the same `where`, so a variant of another product matches
    // nothing.
    const result = moveToCartSchema.safeParse({
      productId: "prod_123",
      variantId: "var_456",
    });
    expect(result.success).toBe(true);
  });
});
