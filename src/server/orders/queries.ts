import { prisma } from "@/lib/db";
import { toStorage } from "@/lib/money";
import { readAddressSnapshot, type AddressSnapshot } from "@/server/orders/snapshot";
import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";

/**
 * Order reads (SEC-23).
 *
 * Every function takes a `userId` and puts it in the `where` clause. None of
 * them accepts an order id alone: an order number is short and human-readable
 * by design (SEC-29), which makes "look it up, then check who owns it" exactly
 * the pattern that leaks other people's orders under a race or a forgotten
 * early return.
 */

export interface OrderItemView {
  productTitle: string;
  productSlug: string;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  image: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderSummary {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: Date;
  currency: string;
  grandTotal: string;
  itemCount: number;
}

export interface OrderDetail extends OrderSummary {
  email: string;
  subtotal: string;
  shippingTotal: string;
  taxTotal: string;
  discountTotal: string;
  shippingMethod: string | null;
  shippingAddress: AddressSnapshot | null;
  paidAt: Date | null;
  expiresAt: Date | null;
  items: OrderItemView[];
}

/** Newest first, capped — an account page is not a data-export endpoint. */
export async function listOrders(userId: string, limit = 20): Promise<OrderSummary[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { placedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      currency: true,
      grandTotal: true,
      items: { select: { quantity: true } },
    },
  });

  return orders.map((order) => ({
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    currency: order.currency,
    grandTotal: toStorage(order.grandTotal.toString()),
    itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
  }));
}

export async function getOrder(
  userId: string,
  orderNumber: string,
): Promise<OrderDetail | null> {
  const order = await prisma.order.findFirst({
    where: { orderNumber, userId },
    select: {
      orderNumber: true,
      email: true,
      status: true,
      paymentStatus: true,
      placedAt: true,
      paidAt: true,
      expiresAt: true,
      currency: true,
      subtotal: true,
      shippingTotal: true,
      taxTotal: true,
      discountTotal: true,
      grandTotal: true,
      shippingMethod: true,
      shippingAddress: true,
      items: {
        select: {
          productTitle: true,
          productSlug: true,
          variantSize: true,
          variantColorName: true,
          variantColorHex: true,
          sku: true,
          image: true,
          unitPrice: true,
          quantity: true,
          lineTotal: true,
        },
      },
    },
  });

  if (!order) return null;

  return {
    orderNumber: order.orderNumber,
    email: order.email,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    expiresAt: order.expiresAt,
    currency: order.currency,
    subtotal: toStorage(order.subtotal.toString()),
    shippingTotal: toStorage(order.shippingTotal.toString()),
    taxTotal: toStorage(order.taxTotal.toString()),
    discountTotal: toStorage(order.discountTotal.toString()),
    grandTotal: toStorage(order.grandTotal.toString()),
    shippingMethod: order.shippingMethod,
    shippingAddress: readAddressSnapshot(order.shippingAddress),
    itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
    items: order.items.map((item) => ({
      productTitle: item.productTitle,
      productSlug: item.productSlug,
      size: item.variantSize,
      colorName: item.variantColorName,
      colorHex: item.variantColorHex,
      sku: item.sku,
      image: item.image,
      unitPrice: toStorage(item.unitPrice.toString()),
      quantity: item.quantity,
      lineTotal: toStorage(item.lineTotal.toString()),
    })),
  };
}

/**
 * The status the return page polls while a payment settles. Deliberately thin:
 * it is requested repeatedly and reveals nothing beyond what the shopper's own
 * order page already shows.
 */
export async function getOrderStatus(
  userId: string,
  orderNumber: string,
): Promise<{ status: OrderStatus; paymentStatus: PaymentStatus } | null> {
  return prisma.order.findFirst({
    where: { orderNumber, userId },
    select: { status: true, paymentStatus: true },
  });
}
