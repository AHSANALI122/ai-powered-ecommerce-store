import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "@/server/payments/stripe";

/**
 * The webhook signature is the entire authentication of Stripe's callback: it
 * is the difference between "Stripe says this order was paid" and "anyone who
 * can reach the URL says so" (SEC-6). It is also the one part of the Stripe
 * leg that can be pinned down without an account, so it is tested here.
 */

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"checkout.session.completed"}';

function sign(payload: string, timestamp: number, secret = SECRET): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  const now = 1_700_000_000;

  it("accepts a correctly signed payload", () => {
    expect(verifyStripeSignature(BODY, sign(BODY, now), SECRET, now)).toBe(true);
  });

  it("rejects a payload signed with a different secret", () => {
    const header = sign(BODY, now, "whsec_wrong");
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(false);
  });

  it("rejects a modified body under a valid signature", () => {
    // The attack this stops: replaying a real event with the amount edited.
    const header = sign(BODY, now);
    const tampered = BODY.replace("evt_1", "evt_2");
    expect(verifyStripeSignature(tampered, header, SECRET, now)).toBe(false);
  });

  it("rejects a signature outside the replay window", () => {
    const header = sign(BODY, now - 3600);
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(false);
  });

  it("accepts a signature inside the replay window", () => {
    const header = sign(BODY, now - 60);
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(true);
  });

  it("rejects a future-dated signature beyond tolerance", () => {
    const header = sign(BODY, now + 3600);
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(false);
  });

  it("accepts a header carrying several v1 signatures, one of which matches", () => {
    // Stripe sends multiple during a signing-secret rotation.
    const valid = sign(BODY, now);
    const header = `${valid},v1=${"0".repeat(64)}`;
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyStripeSignature(BODY, null, SECRET, now)).toBe(false);
  });

  it("rejects a header with no timestamp", () => {
    const signature = createHmac("sha256", SECRET)
      .update(`${now}.${BODY}`, "utf8")
      .digest("hex");
    expect(verifyStripeSignature(BODY, `v1=${signature}`, SECRET, now)).toBe(false);
  });

  it("rejects a header with no v1 signature", () => {
    expect(verifyStripeSignature(BODY, `t=${now}`, SECRET, now)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const header = sign(BODY, now).replace(`t=${now}`, "t=not-a-number");
    expect(verifyStripeSignature(BODY, header, SECRET, now)).toBe(false);
  });
});
