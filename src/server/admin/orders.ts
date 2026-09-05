import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { toStorage } from "@/lib/money";
import { paged, paginate, type Paged } from "@/lib/validation/admin/list";
import type { OrderListQuery } from "@/lib/validation/admin/operations";
import { readAddressSnapshot, type AddressSnapshot } from "@/server/orders/snapshot";
import { providerFor } from "@/server/payments";
import type { WriteResult } from "@/server/admin/products";

/**
 * Order administration (F4).
 *
 * These reads are the one place in the application that is *not* owner-scoped,
 * which is exactly why they live in their own module rather than growing a
 * `userId?` parameter on `src/server/orders/queries.ts`. That file's contract
 * is "every function takes a userId and puts it in the where clause" (SEC-23);
 * an optional one would make the safe call and the store-wide call look
 * identical at the call site, and the store-wide one is the default a mistake
 * falls into. The guard is at the route instead, where the role is re-read from
 * the database on every request (SEC-7).
 *
 * The write side is a state machine. An operator moves an order along its
 * lifecycle; they never assert that money arrived. There is no path here that
 * sets `paymentStatus = PAID` — that belongs to `captureOrder`, behind a
 * verified provider signal and a transaction-inquiry (SEC-6, AD-8).
 */

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Legal operator transitions, keyed by where the order is now.
 *
 * `PENDING` is only cancellable — an unpaid order has no stock held against it
 * (SEC-19), so cancelling releases nothing and is always safe. It cannot be
 * advanced to PROCESSING by hand, because PROCESSING means "paid", and the only
 * thing entitled to say that is a verified capture.
 *
 * `EXPIRED`, `CANCELLED` and `REFUNDED` are terminal. Reviving an expired order
 * would resurrect a payment window the cron deliberately closed.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function allowedTransitions(status: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[status];
}

export type TransitionOutcome =
  "UPDATED" | "REFUNDED" | "REFUND_REQUIRES_MANUAL_ACTION" | "NO_CHANGE";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AdminOrderRow {
  orderNumber: string;
  email: string;
  customerName: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: Date;
  paidAt: Date | null;
  currency: string;
  grandTotal: string;
  itemCount: number;
  provider: string | null;
}

export interface AdminOrderDetail extends AdminOrderRow {
  userId: string | null;
  subtotal: string;
  shippingTotal: string;
  taxTotal: string;
  discountTotal: string;
  shippingMethod: string | null;
  shippingAddress: AddressSnapshot | null;
  providerRef: string | null;
  refundRef: string | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date | null;
  allowedTransitions: readonly OrderStatus[];
  items: {
    productTitle: string;
    productSlug: string;
    sku: string;
    size: string;
    colorName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    /** Null once the variant has been deleted from the catalogue. */
    variantId: string | null;
  }[];
}

const ORDER_BY: Record<
  OrderListQuery["sort"],
  (dir: "asc" | "desc") => Prisma.OrderOrderByWithRelationInput
> = {
  placedAt: (dir) => ({ placedAt: dir }),
  grandTotal: (dir) => ({ grandTotal: dir }),
  orderNumber: (dir) => ({ orderNumber: dir }),
};

export async function listAdminOrders(
  query: OrderListQuery,
): Promise<Paged<AdminOrderRow>> {
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.q
      ? {
          OR: [
            { orderNumber: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: ORDER_BY[query.sort](query.dir),
      ...paginate(query),
      select: {
        orderNumber: true,
        email: true,
        status: true,
        paymentStatus: true,
        placedAt: true,
        paidAt: true,
        currency: true,
        grandTotal: true,
        provider: true,
        user: { select: { name: true } },
        items: { select: { quantity: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return paged(
    rows.map((row) => ({
      orderNumber: row.orderNumber,
      email: row.email,
      customerName: row.user?.name ?? null,
      status: row.status,
      paymentStatus: row.paymentStatus,
      placedAt: row.placedAt,
      paidAt: row.paidAt,
      currency: row.currency,
      grandTotal: toStorage(row.grandTotal.toString()),
      itemCount: row.items.reduce((count, item) => count + item.quantity, 0),
      provider: row.provider,
    })),
    total,
    query,
  );
}

export async function getAdminOrder(
  orderNumber: string,
): Promise<AdminOrderDetail | null> {
  const row = await prisma.order.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      userId: true,
      email: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      paidAt: true,
      expiresAt: true,
      cancelledAt: true,
      refundedAt: true,
      refundRef: true,
      currency: true,
      subtotal: true,
      shippingTotal: true,
      taxTotal: true,
      discountTotal: true,
      grandTotal: true,
      shippingMethod: true,
      shippingAddress: true,
      provider: true,
      providerRef: true,
      user: { select: { name: true } },
      items: {
        select: {
          productTitle: true,
          productSlug: true,
          sku: true,
          variantSize: true,
          variantColorName: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          variantId: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    orderNumber: row.orderNumber,
    userId: row.userId,
    email: row.email,
    customerName: row.user?.name ?? null,
    status: row.status,
    paymentStatus: row.paymentStatus,
    placedAt: row.placedAt,
    paidAt: row.paidAt,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
    refundedAt: row.refundedAt,
    refundRef: row.refundRef,
    currency: row.currency,
    subtotal: toStorage(row.subtotal.toString()),
    shippingTotal: toStorage(row.shippingTotal.toString()),
    taxTotal: toStorage(row.taxTotal.toString()),
    discountTotal: toStorage(row.discountTotal.toString()),
    grandTotal: toStorage(row.grandTotal.toString()),
    shippingMethod: row.shippingMethod,
    shippingAddress: readAddressSnapshot(row.shippingAddress),
    provider: row.provider,
    providerRef: row.providerRef,
    itemCount: row.items.reduce((count, item) => count + item.quantity, 0),
    allowedTransitions: allowedTransitions(row.status),
    items: row.items.map((item) => ({
      productTitle: item.productTitle,
      productSlug: item.productSlug,
      sku: item.sku,
      size: item.variantSize,
      colorName: item.variantColorName,
      quantity: item.quantity,
      unitPrice: toStorage(item.unitPrice.toString()),
      lineTotal: toStorage(item.lineTotal.toString()),
      variantId: item.variantId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Moves an order to `target`, or explains why it cannot go there.
 *
 * The refund branch is the one with teeth. Restoring stock is not optional:
 * capture decremented it inside the verified-PAID transaction (SEC-19), so a
 * refund that skipped the restock would leak a unit of inventory per refund
 * until the shelf count silently disagreed with the shop floor. Only variants
 * that still exist are restocked — `OrderItem.variantId` is `SetNull`, so a
 * deleted variant has nothing left to credit.
 */
export async function transitionOrder(params: {
  orderNumber: string;
  target: OrderStatus;
}): Promise<WriteResult<{ outcome: TransitionOutcome; status: OrderStatus }>> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: params.orderNumber },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      email: true,
      status: true,
      paymentStatus: true,
      currency: true,
      grandTotal: true,
      expiresAt: true,
      provider: true,
      providerRef: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });
  if (!order) return { ok: false, reason: "NOT_FOUND", message: "Order not found." };

  if (order.status === params.target) {
    return { ok: true, value: { outcome: "NO_CHANGE", status: order.status } };
  }

  if (!TRANSITIONS[order.status].includes(params.target)) {
    return {
      ok: false,
      reason: "INVALID",
      message: `An order that is ${order.status} cannot become ${params.target}.`,
    };
  }

  if (params.target === "REFUNDED") {
    if (order.paymentStatus !== "PAID") {
      return {
        ok: false,
        reason: "INVALID",
        message: "Only a paid order can be refunded.",
      };
    }
    return refundOrder(order);
  }

  if (params.target === "CANCELLED" && order.paymentStatus === "PAID") {
    // Cancelling would leave the money taken and the stock decremented. The
    // operator wants a refund; make them say so.
    return {
      ok: false,
      reason: "INVALID",
      message: "This order is paid — refund it instead of cancelling it.",
    };
  }

  const now = new Date();
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: params.target,
      ...(params.target === "CANCELLED" ? { cancelledAt: now, expiresAt: null } : {}),
    },
  });

  await queueStatusNotification(order, params.target);

  return { ok: true, value: { outcome: "UPDATED", status: params.target } };
}

type RefundableOrder = {
  id: string;
  orderNumber: string;
  userId: string | null;
  email: string;
  currency: string;
  grandTotal: Prisma.Decimal;
  expiresAt: Date | null;
  provider: "EASYPAISA" | "STRIPE" | "FAKE" | null;
  providerRef: string | null;
  items: { variantId: string | null; quantity: number }[];
};

/**
 * Mirrors `refundUnfulfillable` in capture.ts, deliberately: the provider call
 * happens *outside* the transaction (it is a network round trip and must not
 * hold a database transaction open), and the order is marked REFUNDED whether
 * or not the provider could reverse the charge. Easypaisa has no merchant
 * refund API, so `automatic: false` is the normal case there — the obligation
 * goes into the outbox for a human instead of being silently kept.
 */
async function refundOrder(
  order: RefundableOrder,
): Promise<WriteResult<{ outcome: TransitionOutcome; status: OrderStatus }>> {
  const amount = toStorage(order.grandTotal.toString());
  const provider = providerFor(order.provider);

  let refundRef: string | null = null;
  let automatic = false;
  try {
    const refund = await provider.refund(
      {
        id: order.id,
        orderNumber: order.orderNumber,
        email: order.email,
        currency: order.currency,
        grandTotal: amount,
        expiresAt: order.expiresAt,
        providerRef: order.providerRef,
      },
      amount,
    );
    refundRef = refund.refundRef;
    automatic = refund.automatic;
  } catch (error) {
    console.error(`[admin] refund call failed for ${order.orderNumber}`, error);
  }

  const restockable = order.items.filter(
    (item): item is { variantId: string; quantity: number } => item.variantId !== null,
  );

  await prisma.$transaction([
    prisma.order.update({
      where: { id: order.id },
      data: {
        status: "REFUNDED",
        paymentStatus: "REFUNDED",
        refundedAt: new Date(),
        refundRef,
        expiresAt: null,
      },
    }),
    ...restockable.map((item) =>
      prisma.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      }),
    ),
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
          reason: "OPERATOR",
          refundRef,
          /** False means a human must complete the reversal in the portal. */
          automatic,
        },
        nextAttemptAt: new Date(),
      },
    }),
  ]);

  if (!automatic) {
    console.error(
      `[admin] ${order.orderNumber} marked REFUNDED but the provider could not reverse the charge; REQUIRES MANUAL ACTION`,
    );
  }

  return {
    ok: true,
    value: {
      outcome: automatic ? "REFUNDED" : "REFUND_REQUIRES_MANUAL_ACTION",
      status: "REFUNDED",
    },
  };
}

/**
 * The customer-facing side of a transition, written to the outbox (F6 sends
 * it). Queueing is best-effort by design in `queueNotification`; here the row
 * is only written for the transitions a customer expects to hear about.
 */
async function queueStatusNotification(
  order: { id: string; orderNumber: string; userId: string | null; email: string },
  target: OrderStatus,
): Promise<void> {
  const type =
    target === "SHIPPED"
      ? "ORDER_SHIPPED"
      : target === "DELIVERED"
        ? "ORDER_DELIVERED"
        : null;
  if (!type) return;

  const { queueNotification } = await import("@/server/notifications/queue");
  await queueNotification({
    type,
    to: order.email,
    userId: order.userId,
    subject:
      type === "ORDER_SHIPPED"
        ? `Order ${order.orderNumber} is on its way`
        : `Order ${order.orderNumber} was delivered`,
    payload: { orderNumber: order.orderNumber },
  });
}

// ---------------------------------------------------------------------------
// Dashboard counters
// ---------------------------------------------------------------------------

export interface AdminOverview {
  ordersToday: number;
  ordersPending: number;
  ordersProcessing: number;
  reviewsPending: number;
  productsActive: number;
  productsInactive: number;
  lowStockVariants: number;
  seedProducts: number;
}

export async function getAdminOverview(
  lowStockThreshold: number,
): Promise<AdminOverview> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    ordersToday,
    ordersPending,
    ordersProcessing,
    reviewsPending,
    productsActive,
    productsInactive,
    lowStockVariants,
    seedProducts,
  ] = await Promise.all([
    prisma.order.count({ where: { placedAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "PROCESSING" } }),
    prisma.review.count({ where: { status: "PENDING" } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.product.count({ where: { isActive: false } }),
    prisma.productVariant.count({
      where: { isActive: true, stock: { lte: lowStockThreshold } },
    }),
    // SEC-27: demo rows must be purged before go-live, so the dashboard says
    // how many are still there rather than leaving it to be remembered.
    prisma.product.count({ where: { source: "pexels" } }),
  ]);

  return {
    ordersToday,
    ordersPending,
    ordersProcessing,
    reviewsPending,
    productsActive,
    productsInactive,
    lowStockVariants,
    seedProducts,
  };
}
