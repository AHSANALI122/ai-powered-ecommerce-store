import { describe, expect, it } from "vitest";
import { allowedTransitions } from "@/server/admin/orders";
import type { OrderStatus } from "@/generated/prisma/enums";

/**
 * The order state machine (SEC-19).
 *
 * `transitionOrder` needs a database, so what is tested here is the map it
 * consults — which is where the rules actually live. Every assertion below is a
 * statement about money or stock, not about tidiness.
 */

const ALL: OrderStatus[] = [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
];

describe("allowedTransitions", () => {
  it("lets an operator cancel a PENDING order and nothing else", () => {
    // PENDING means unpaid. It cannot be advanced by hand because PROCESSING
    // means paid, and only a verified capture may say that (SEC-6).
    expect(allowedTransitions("PENDING")).toEqual(["CANCELLED"]);
  });

  it("never offers PROCESSING as a destination from an unpaid state", () => {
    for (const status of ALL) {
      if (status === "PROCESSING") continue;
      expect(allowedTransitions(status)).not.toContain("PROCESSING");
    }
  });

  it("never offers PENDING or EXPIRED as a destination", () => {
    // Both are assigned by the system — PENDING at creation, EXPIRED by the
    // cron. Reviving an expired order would reopen a payment window that was
    // deliberately closed.
    for (const status of ALL) {
      expect(allowedTransitions(status)).not.toContain("PENDING");
      expect(allowedTransitions(status)).not.toContain("EXPIRED");
    }
  });

  it("moves a paid order forward through fulfilment", () => {
    expect(allowedTransitions("PROCESSING")).toContain("SHIPPED");
    expect(allowedTransitions("SHIPPED")).toContain("DELIVERED");
  });

  it("does not allow fulfilment to run backwards", () => {
    expect(allowedTransitions("SHIPPED")).not.toContain("PROCESSING");
    expect(allowedTransitions("DELIVERED")).not.toContain("SHIPPED");
  });

  it("allows a refund from every state where money has been taken", () => {
    for (const status of ["PROCESSING", "SHIPPED", "DELIVERED"] as const) {
      expect(allowedTransitions(status)).toContain("REFUNDED");
    }
  });

  it.each(["CANCELLED", "EXPIRED", "REFUNDED"] as const)(
    "treats %s as terminal",
    (status) => {
      expect(allowedTransitions(status)).toEqual([]);
    },
  );

  it("never lets a status transition to itself", () => {
    for (const status of ALL) {
      expect(allowedTransitions(status)).not.toContain(status);
    }
  });
});
