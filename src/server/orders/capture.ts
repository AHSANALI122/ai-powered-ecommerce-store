import { prisma } from "@/lib/db";
import { eq, toStorage } from "@/lib/money";
import { providerFor } from "@/server/payments";
import type { PaymentOrder } from "@/server/payments/provider";

/**
 * Capture (SEC-5, SEC-6, SEC-11, SEC-19).
 *
 * This is the one function in the system where a mistake costs money, so it is
 * written to make each failure mode explicit.
 *
 * **Nothing here trusts the caller.** A webhook handler has already verified a
 * signature or hash, which proves the message came from the provider. It does
 * not prove that money moved, or that the amount matches. So the first thing
 * this does is ask the provider directly (`inquire`) and compare the answer to
 * the order's own total. Both must agree before anything changes.
 *
 * **Stock is decremented here and nowhere else.** Not at PENDING, which would
 * let an abandoned cart strand inventory; not after the response, which would
 * oversell. The decrement is a conditional `updateMany` guarded on
 * `stock >= quantity` with an affected-count assertion — under concurrency
 * Postgres re-evaluates that predicate against the committed row, so two
 * simultaneous captures for the last unit produce exactly one success and one
 * failed assertion. There is no read-then-write and no application-level lock,
 * because neither is safe across serverless instances (AD-7).
 *
 * **A capture that cannot be honoured is refunded, never silently kept.** If
 * any assertion fails the whole transaction rolls back, and the money is
 * returned outside it.
 */

export type CaptureOutcome =
  | "PAID"
  | "ALREADY_PAID"
  | "NOT_SETTLED"
  | "AMOUNT_MISMATCH"
  | "OUT_OF_STOCK_REFUNDED"
  | "OUT_OF_STOCK_REFUND_FAILED"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_PAYABLE";

export interface CaptureResult {
  outcome: CaptureOutcome;
  orderNumber: string | null;
}

/** Thrown inside the transaction to roll it back; never escapes this module. */
class StockUnavailableError extends Error {
  constructor(readonly variantId: string) {
    super(`Variant ${variantId} no longer has the ordered quantity.`);
    this.name = "StockUnavailableError";
  }
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  email: true,
  currency: true,
  grandTotal: true,
  status: true,
  paymentStatus: true,
  provider: true,
  providerRef: true,
  expiresAt: true,
  items: {
    select: { variantId: true, quantity: true, productTitle: true },
  },
} as const;

function toPaymentOrder(order: {
  id: string;
  orderNumber: string;
  email: string;
  currency: string;
  grandTotal: { toString(): string };
  expiresAt: Date | null;
  providerRef: string | null;
}): PaymentOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    email: order.email,
    currency: order.currency,
    grandTotal: order.grandTotal.toString(),
    expiresAt: order.expiresAt,
    providerRef: order.providerRef,
  };
}

/**
 * @param providerRef the reference the callback named, when it named a better
 *        one than the order already holds (Easypaisa mints its payment token
 *        only once the shopper reaches the hosted page).
 */
export async function captureOrder(params: {
  orderNumber: string;
  providerRef?: string | null;
}): Promise<CaptureResult> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: params.orderNumber },
    select: ORDER_SELECT,
  });

  if (!order) return { outcome: "ORDER_NOT_FOUND", orderNumber: null };

  // Already captured. Providers retry until they get a 200, so this is the
  // normal path for a redelivered webhook, not an error.
  if (order.paymentStatus === "PAID") {
    return { outcome: "ALREADY_PAID", orderNumber: order.orderNumber };
  }
  if (order.paymentStatus !== "PENDING") {
    return { outcome: "ORDER_NOT_PAYABLE", orderNumber: order.orderNumber };
  }

  const provider = providerFor(order.provider);
  const paymentOrder = toPaymentOrder({
    ...order,
    providerRef: params.providerRef ?? order.providerRef,
  });

  // --- Ask the provider what actually happened (AD-8, SEC-6) --------------
  const inquiry = await provider.inquire(paymentOrder);

  if (inquiry.state !== "PAID") {
    return { outcome: "NOT_SETTLED", orderNumber: order.orderNumber };
  }

  // A settled payment for the wrong amount is not this order's payment. This
  // is the check that makes a tampered or stale amount unusable (SEC-4).
  const expected = toStorage(order.grandTotal.toString());
  const amountAgrees = inquiry.amount !== null && eq(inquiry.amount, expected);
  const currencyAgrees =
    inquiry.currency === null || inquiry.currency.toUpperCase() === order.currency;

  if (!amountAgrees || !currencyAgrees) {
    console.error(
      `[capture] amount mismatch on ${order.orderNumber}: provider reported ` +
        `${inquiry.amount ?? "null"} ${inquiry.currency ?? "?"}, order is ${expected} ${order.currency}`,
    );
    return { outcome: "AMOUNT_MISMATCH", orderNumber: order.orderNumber };
  }

  const resolvedRef = inquiry.providerRef ?? params.providerRef ?? order.providerRef;

  // --- One transaction: mark paid, take stock, clear cart, queue mail -----
  try {
    const captured = await prisma.$transaction(async (tx) => {
      // Guarded on PENDING. Zero rows means another delivery of the same
      // webhook won the race — this one exits cleanly and changes nothing.
      const claimed = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: "PENDING" },
        data: {
          paymentStatus: "PAID",
          status: "PROCESSING",
          paidAt: new Date(),
          providerRef: resolvedRef,
          expiresAt: null,
        },
      });
      if (claimed.count === 0) return false;

      // The oversell defence (SEC-5). The predicate and the write are one
      // statement, so no window exists between checking and taking.
      for (const item of order.items) {
        if (!item.variantId) throw new StockUnavailableError("(deleted variant)");
        const decremented = await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (decremented.count !== 1) throw new StockUnavailableError(item.variantId);
      }

      // Remove exactly what was bought from the buyer's cart — not the whole
      // cart, which may have gained items while the payment was in flight.
      if (order.userId) {
        const variantIds = order.items
          .map((item) => item.variantId)
          .filter((id): id is string => id !== null);
        await tx.cartItem.deleteMany({
          where: { cart: { userId: order.userId }, variantId: { in: variantIds } },
        });
      }

      // Queued inside the transaction so a crash cannot commit the order and
      // lose its confirmation email (the F6 worker sends it).
      await tx.notification.create({
        data: {
          userId: order.userId,
          type: "ORDER_CONFIRMATION",
          status: "QUEUED",
          to: order.email.toLowerCase(),
          subject: `Order ${order.orderNumber} confirmed`,
          payload: {
            orderNumber: order.orderNumber,
            total: expected,
            currency: order.currency,
          },
          nextAttemptAt: new Date(),
        },
      });

      return true;
    });

    if (!captured) {
      return { outcome: "ALREADY_PAID", orderNumber: order.orderNumber };
    }
    return { outcome: "PAID", orderNumber: order.orderNumber };
  } catch (error) {
    if (!(error instanceof StockUnavailableError)) throw error;

    // The transaction rolled back: the order is still PENDING and no stock
    // moved. But the shopper's money did. Return it (SEC-19).
    return refundUnfulfillable(order, expected, resolvedRef);
  }
}

/**
 * Money was taken for stock that vanished between order and capture. The order
 * is marked REFUNDED regardless of whether the provider could reverse the
 * charge automatically — Easypaisa has no merchant refund API — and an
 * operator notification is queued either way, so the obligation is always
 * visible rather than silently kept.
 */
async function refundUnfulfillable(
  order: {
    id: string;
    orderNumber: string;
    userId: string | null;
    email: string;
    currency: string;
    grandTotal: { toString(): string };
    expiresAt: Date | null;
    providerRef: string | null;
    provider: "EASYPAISA" | "STRIPE" | "FAKE" | null;
  },
  amount: string,
  providerRef: string | null,
): Promise<CaptureResult> {
  const provider = providerFor(order.provider);

  let refundRef: string | null = null;
  let automatic = false;
  try {
    const refund = await provider.refund(
      toPaymentOrder({ ...order, providerRef }),
      amount,
    );
    refundRef = refund.refundRef;
    automatic = refund.automatic;
  } catch (error) {
    console.error(`[capture] refund failed for ${order.orderNumber}`, error);
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "REFUNDED",
        status: "REFUNDED",
        refundedAt: new Date(),
        refundRef,
        providerRef,
        expiresAt: null,
      },
    }),
    prisma.notification.create({
      data: {
        userId: order.userId,
        type: "ORDER_REFUNDED",
        status: "QUEUED",
        to: order.email.toLowerCase(),
        subject: `Order ${order.orderNumber} refunded`,
        payload: {
          orderNumber: order.orderNumber,
          amount,
          currency: order.currency,
          reason: "OUT_OF_STOCK",
          refundRef,
          /** False means a human must complete the reversal in the portal. */
          automatic,
        },
        nextAttemptAt: new Date(),
      },
    }),
  ]);

  console.error(
    `[capture] ${order.orderNumber} paid but unfulfillable; refund ${automatic ? "issued" : "REQUIRES MANUAL ACTION"}`,
  );

  return {
    outcome: automatic ? "OUT_OF_STOCK_REFUNDED" : "OUT_OF_STOCK_REFUND_FAILED",
    orderNumber: order.orderNumber,
  };
}

/** Marks a payment the provider reported as failed, leaving stock untouched. */
export async function failOrder(orderNumber: string): Promise<void> {
  await prisma.order.updateMany({
    where: { orderNumber, paymentStatus: "PENDING" },
    data: { paymentStatus: "FAILED" },
  });
}
