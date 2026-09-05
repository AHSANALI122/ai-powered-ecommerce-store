import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { mul, toStorage } from "@/lib/money";
import { getRedis, redisKeys } from "@/lib/redis";
import { buildQuote } from "@/server/pricing/quote";
import { activeProvider, activeProviderKind } from "@/server/payments";
import { PaymentProviderError, type PaymentRedirect } from "@/server/payments/provider";
import { nextOrderNumber } from "@/server/orders/number";
import { toAddressSnapshot } from "@/server/orders/snapshot";
import { cartWhere, type CartOwner } from "@/server/cart/owner";

/**
 * Checkout (SEC-4, SEC-11, SEC-19, SEC-20, SEC-23, SEC-29).
 *
 * The order of operations here is the security design, not a preference:
 *
 *  1. **Idempotency first.** A repeated attempt returns the order the first
 *     attempt made, before anything else can happen twice (SEC-20).
 *  2. **Stock is validated, never decremented.** Holding stock at PENDING
 *     would let an abandoned cart strand inventory; the decrement happens
 *     inside the verified-paid transaction and nowhere else (SEC-19).
 *  3. **Every amount is recomputed from the database here**, immediately
 *     before the order row is written, from the same `buildQuote` the checkout
 *     screen rendered (SEC-4, SEC-11). The request body contains ids only.
 *  4. **The order is written before the provider is called.** A payment that
 *     exists with no order to attach it to is the one failure mode with no
 *     clean recovery.
 */

export type CheckoutFailure =
  | "EMPTY_CART"
  | "CART_UNAVAILABLE"
  | "ADDRESS_NOT_FOUND"
  | "SHIPPING_UNAVAILABLE"
  | "IN_PROGRESS"
  | "PROVIDER_ERROR";

export interface CheckoutSuccess {
  ok: true;
  orderNumber: string;
  grandTotal: string;
  currency: string;
  redirect: PaymentRedirect;
  /** True when this call returned an order a previous attempt created. */
  replayed: boolean;
}

export type CheckoutResult =
  CheckoutSuccess | { ok: false; reason: CheckoutFailure; message: string };

/** How long a claimed idempotency key stays claimed while a checkout runs. */
const IDEMPOTENCY_TTL_SECONDS = 15 * 60;

interface CheckoutInput {
  userId: string;
  email: string;
  owner: CartOwner;
  addressId: string;
  shippingRateId: string;
  idempotencyKey: string;
}

/**
 * Looks up an order already created for this key. Scoped to the caller, so a
 * guessed key reveals nothing about somebody else's order (SEC-23).
 */
async function findReplay(
  userId: string,
  idempotencyKey: string,
): Promise<CheckoutSuccess | null> {
  const order = await prisma.order.findFirst({
    where: { idempotencyKey, userId },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      currency: true,
      provider: true,
      providerRef: true,
      email: true,
      expiresAt: true,
      paymentStatus: true,
    },
  });

  if (!order) return null;

  // A replayed attempt must land on the same payment, not open a second one.
  // Providers are asked for the redirect again with the same order, and both
  // implemented providers are idempotent on the order id for exactly this.
  const provider = activeProvider();
  const created = await provider.createPayment({
    id: order.id,
    orderNumber: order.orderNumber,
    email: order.email,
    currency: order.currency,
    grandTotal: order.grandTotal.toString(),
    expiresAt: order.expiresAt,
    providerRef: order.providerRef,
  });

  return {
    ok: true,
    orderNumber: order.orderNumber,
    grandTotal: toStorage(order.grandTotal.toString()),
    currency: order.currency,
    redirect: created.redirect,
    replayed: true,
  };
}

export async function startCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  // --- 1. Idempotency (SEC-20) --------------------------------------------
  // The database check comes first because it is authoritative and works even
  // when Redis is unconfigured in development; Redis then guards the window
  // between "a checkout started" and "its order row exists".
  const replay = await findReplay(input.userId, input.idempotencyKey);
  if (replay) return replay;

  const redis = getRedis();
  const claimKey = redisKeys.idempotency(input.idempotencyKey);
  if (redis) {
    const claimed = await redis.set(claimKey, input.userId, {
      nx: true,
      ex: IDEMPOTENCY_TTL_SECONDS,
    });
    if (claimed === null) {
      // Someone holds this key. Either the first attempt is still running, or
      // it finished between our two checks — look once more before refusing.
      const settled = await findReplay(input.userId, input.idempotencyKey);
      if (settled) return settled;
      return {
        ok: false,
        reason: "IN_PROGRESS",
        message: "This checkout is already being processed.",
      };
    }
  }

  try {
    return await createPendingOrder(input);
  } catch (error) {
    // Release the claim so a genuine retry is not locked out by a failure.
    if (redis) await redis.del(claimKey).catch(() => undefined);
    throw error;
  }
}

async function createPendingOrder(input: CheckoutInput): Promise<CheckoutResult> {
  // --- 2. The cart, owner-scoped (SEC-23) ---------------------------------
  const cart = await prisma.cart.findFirst({
    where: cartWhere(input.owner),
    select: {
      id: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          quantity: true,
          variantId: true,
          variant: {
            select: {
              id: true,
              size: true,
              colorName: true,
              colorHex: true,
              sku: true,
              price: true,
              stock: true,
              isActive: true,
              product: {
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  images: true,
                  basePrice: true,
                  isActive: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return { ok: false, reason: "EMPTY_CART", message: "Your cart is empty." };
  }

  // --- 3. Validate stock. Do not decrement (SEC-19) ------------------------
  // This is a pre-flight courtesy that fails fast on an obviously unbuyable
  // cart. It is explicitly NOT the oversell defence: between here and payment
  // anyone may buy the same unit. The conditional decrement inside the
  // verified-paid transaction is what makes oversell impossible.
  const blocked = cart.items.filter(
    (item) =>
      !item.variant.isActive ||
      !item.variant.product.isActive ||
      item.variant.stock < item.quantity,
  );
  if (blocked.length > 0) {
    return {
      ok: false,
      reason: "CART_UNAVAILABLE",
      message: "Some items are no longer available. Review your cart.",
    };
  }

  // --- 4. The address, owner-scoped (SEC-23) ------------------------------
  const address = await prisma.address.findFirst({
    where: { id: input.addressId, userId: input.userId },
  });
  if (!address) {
    return {
      ok: false,
      reason: "ADDRESS_NOT_FOUND",
      message: "Choose a delivery address.",
    };
  }

  // --- 5. Recompute every amount from the database (SEC-4, SEC-11) --------
  const lines = cart.items.map((item) => ({
    unitPrice: (item.variant.price ?? item.variant.product.basePrice).toString(),
    quantity: item.quantity,
  }));

  const quote = await buildQuote({
    lines,
    country: address.country,
    shippingRateId: input.shippingRateId,
  });

  if (!quote.shipping) {
    // The rate id did not belong to this destination's zone, or the zone has
    // no active rates. Either way we will not guess a price.
    return {
      ok: false,
      reason: "SHIPPING_UNAVAILABLE",
      message: "No delivery option is available for that address.",
    };
  }

  // --- 6. The order: PENDING, with snapshots (SEC-19, §5) -----------------
  const env = serverEnv();
  const expiresAt = new Date(Date.now() + env.ORDER_EXPIRY_MINUTES * 60 * 1000);

  const order = await prisma.order.create({
    data: {
      orderNumber: await nextOrderNumber(),
      userId: input.userId,
      email: input.email,
      status: "PENDING",
      paymentStatus: "PENDING",
      currency: quote.currency,
      // Single base currency, no FX (CLAUDE.md). The column exists so adding
      // a second currency later is a feature, not a migration.
      fxRate: null,
      subtotal: quote.subtotal,
      shippingTotal: quote.shippingTotal,
      taxTotal: quote.taxTotal,
      discountTotal: quote.discountTotal,
      grandTotal: quote.grandTotal,
      shippingAddress: toAddressSnapshot(address),
      shippingMethod: `${quote.shipping.zoneName} — ${quote.shipping.name}`,
      provider: activeProviderKind(),
      idempotencyKey: input.idempotencyKey,
      expiresAt,
      items: {
        create: cart.items.map((item) => {
          const unitPrice = toStorage(
            (item.variant.price ?? item.variant.product.basePrice).toString(),
          );
          return {
            variantId: item.variantId,
            productId: item.variant.product.id,
            productTitle: item.variant.product.title,
            productSlug: item.variant.product.slug,
            variantSize: item.variant.size,
            variantColorName: item.variant.colorName,
            variantColorHex: item.variant.colorHex,
            sku: item.variant.sku,
            image: item.variant.product.images[0] ?? null,
            unitPrice,
            quantity: item.quantity,
            lineTotal: toStorage(mul(unitPrice, item.quantity)),
          };
        }),
      },
    },
    select: {
      id: true,
      orderNumber: true,
      email: true,
      currency: true,
      grandTotal: true,
      expiresAt: true,
      providerRef: true,
    },
  });

  // --- 7. Hand the shopper to the provider (AD-8) -------------------------
  try {
    const created = await activeProvider().createPayment({
      id: order.id,
      orderNumber: order.orderNumber,
      email: order.email,
      currency: order.currency,
      grandTotal: order.grandTotal.toString(),
      expiresAt: order.expiresAt,
      providerRef: order.providerRef,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { providerRef: created.providerRef },
    });

    return {
      ok: true,
      orderNumber: order.orderNumber,
      grandTotal: toStorage(order.grandTotal.toString()),
      currency: order.currency,
      redirect: created.redirect,
      replayed: false,
    };
  } catch (error) {
    // The order stays PENDING and the expiry cron will cancel it. Nothing was
    // charged and no stock was taken, so there is nothing to unwind.
    console.error("[checkout] provider createPayment failed", error);
    if (error instanceof PaymentProviderError) {
      return {
        ok: false,
        reason: "PROVIDER_ERROR",
        message: "Payment is temporarily unavailable. Try again shortly.",
      };
    }
    throw error;
  }
}
