import { describe, expect, it } from "vitest";
import {
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_TITLE_MAX,
  reviewListQuerySchema,
  submitReviewSchema,
  updateReviewSchema,
} from "@/lib/validation/review";

/**
 * The review input boundary (SEC-16, SEC-24).
 *
 * The assertions worth reading are the negative ones. `verifiedPurchase`,
 * `status` and `userId` are not fields a shopper is allowed to state, and the
 * way that rule is enforced is that the schema has no such keys and is
 * `.strict()` — so it fails here rather than being silently dropped and then
 * trusted by whatever comes next.
 */

const valid = {
  productId: "prod_123",
  rating: 5,
  body: "Fits exactly as described and the fabric has held up through a dozen washes.",
};

describe("submitReviewSchema", () => {
  it("accepts a well-formed review", () => {
    const result = submitReviewSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects a client-claimed verified-purchase badge", () => {
    // The whole point of the badge: it is derived from the caller's own paid
    // orders on the server and cannot be asserted from outside.
    expect(
      submitReviewSchema.safeParse({ ...valid, verifiedPurchase: true }).success,
    ).toBe(false);
  });

  it("rejects a client-chosen moderation status", () => {
    expect(submitReviewSchema.safeParse({ ...valid, status: "APPROVED" }).success).toBe(
      false,
    );
  });

  it("rejects a client-named author", () => {
    // Identity comes from the session, exactly as it does for the assistant's
    // tools (SEC-3).
    expect(submitReviewSchema.safeParse({ ...valid, userId: "usr_other" }).success).toBe(
      false,
    );
  });

  it("bounds the rating to 1..5", () => {
    for (const rating of [0, 6, -1, 99]) {
      expect(submitReviewSchema.safeParse({ ...valid, rating }).success).toBe(false);
    }
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(submitReviewSchema.safeParse({ ...valid, rating }).success).toBe(true);
    }
  });

  it("rejects a fractional rating", () => {
    expect(submitReviewSchema.safeParse({ ...valid, rating: 4.5 }).success).toBe(false);
  });

  it("bounds the body at both ends", () => {
    expect(
      submitReviewSchema.safeParse({ ...valid, body: "x".repeat(REVIEW_BODY_MIN - 1) })
        .success,
    ).toBe(false);
    expect(
      submitReviewSchema.safeParse({ ...valid, body: "x".repeat(REVIEW_BODY_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it("measures the body after trimming, so whitespace is not content", () => {
    const padded = `   ${"x".repeat(REVIEW_BODY_MIN - 2)}   `;
    expect(submitReviewSchema.safeParse({ ...valid, body: padded }).success).toBe(false);
  });

  it("turns an empty title into null rather than a title of nothing", () => {
    const result = submitReviewSchema.safeParse({ ...valid, title: "   " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBeNull();
  });

  it("bounds the title", () => {
    expect(
      submitReviewSchema.safeParse({ ...valid, title: "x".repeat(REVIEW_TITLE_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe("updateReviewSchema", () => {
  it("has no product or author to change", () => {
    const body = { rating: 4, body: valid.body };
    expect(updateReviewSchema.safeParse(body).success).toBe(true);
    expect(updateReviewSchema.safeParse({ ...body, productId: "prod_other" }).success).toBe(
      false,
    );
    expect(updateReviewSchema.safeParse({ ...body, userId: "usr_other" }).success).toBe(
      false,
    );
  });

  it("cannot ask to stay approved", () => {
    expect(
      updateReviewSchema.safeParse({ rating: 4, body: valid.body, status: "APPROVED" })
        .success,
    ).toBe(false);
  });
});

describe("reviewListQuerySchema", () => {
  it("caps the page size instead of erroring", () => {
    const result = reviewListQuerySchema.safeParse({
      productId: "prod_123",
      pageSize: "100000",
    });
    expect(result.success).toBe(true);
    // `.catch()` on an out-of-range value: a shopper editing the URL gets a
    // sensible page, and the bound still holds (SEC-24).
    if (result.success) expect(result.data.pageSize).toBeLessThanOrEqual(25);
  });

  it("falls back to a whitelisted sort for an unknown token", () => {
    const result = reviewListQuerySchema.safeParse({
      productId: "prod_123",
      sort: "user.passwordHash",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sort).toBe("newest");
  });

  it("still requires a product", () => {
    expect(reviewListQuerySchema.safeParse({ page: 1 }).success).toBe(false);
  });
});
