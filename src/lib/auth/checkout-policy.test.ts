import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The checkout verification gate is policy, and policy read in four places —
 * the cart button, the checkout page, and the two checkout route handlers.
 * These pin the one function they all read it through, because the failure
 * mode of a disagreement is invisible: a button that offers checkout and a
 * POST that then refuses it.
 */

const requireVerified = vi.fn<() => boolean>();

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT: requireVerified() }),
}));

const { canCheckOut, checkoutRequiresVerifiedEmail } =
  await import("@/lib/auth/current-user");

const verified = { emailVerified: new Date("2026-01-01") };
const unverified = { emailVerified: null };

describe("checkout verification policy", () => {
  beforeEach(() => {
    requireVerified.mockReset();
  });

  describe("when the gate is on (the default)", () => {
    beforeEach(() => requireVerified.mockReturnValue(true));

    it("reports that it is on", () => {
      expect(checkoutRequiresVerifiedEmail()).toBe(true);
    });

    it("lets a verified shopper check out", () => {
      expect(canCheckOut(verified)).toBe(true);
    });

    it("stops an unverified shopper", () => {
      expect(canCheckOut(unverified)).toBe(false);
    });
  });

  describe("when the gate is off", () => {
    beforeEach(() => requireVerified.mockReturnValue(false));

    it("reports that it is off", () => {
      expect(checkoutRequiresVerifiedEmail()).toBe(false);
    });

    it("lets an unverified shopper check out", () => {
      expect(canCheckOut(unverified)).toBe(true);
    });

    it("still lets a verified shopper check out", () => {
      expect(canCheckOut(verified)).toBe(true);
    });
  });

  it("never lets a signed-out visitor check out, either way", () => {
    // The session is structural, not policy: an order needs an owner to filter
    // by (SEC-23). No value of the flag may turn this into a guest checkout.
    for (const flag of [true, false]) {
      requireVerified.mockReturnValue(flag);
      expect(canCheckOut(null)).toBe(false);
    }
  });
});
