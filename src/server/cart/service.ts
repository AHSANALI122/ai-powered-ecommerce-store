import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { mul, sum, toStorage } from "@/lib/money";
import { MAX_LINE_QUANTITY } from "@/lib/validation/cart";
import { cartWhere, type CartOwner } from "@/server/cart/owner";

/**
 * The server cart (F3).
 *
 * Three rules hold everywhere in this module:
 *
 *  1. **Lines reference a variant, not a product** (AD-5). Stock and the
 *     effective price live on the variant, so a "product" in a cart would be
 *     ambiguous about both.
 *  2. **Prices are never stored on the line.** A cart is a list of intentions;
 *     the amount is resolved from the database every time it is displayed and
 *     again at checkout (SEC-4, SEC-11). A price frozen into a cart row is a
 *     price a shopper can sit on until it is wrong.
 *  3. **Every query is scoped by owner in its `where`** (SEC-23) — never by
 *     fetching a cart and comparing ids afterwards.
 */

export type LineIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";

export interface CartLine {
  id: string;
  variantId: string;
  productSlug: string;
  productTitle: string;
  image: string | null;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  /** `variant.price ?? product.basePrice`, read now (AD-5). */
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  /** Stock on hand. Advisory only — the binding check is at capture (SEC-5). */
  available: number;
  /** Non-null lines are shown with a warning and block checkout. */
  issue: LineIssue | null;
}

export interface CartView {
  id: string | null;
  currency: string;
  lines: CartLine[];
  itemCount: number;
  subtotal: string;
  /** True when at least one line cannot be bought as it stands. */
  hasIssues: boolean;
}

const LINE_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
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
          slug: true,
          title: true,
          images: true,
          basePrice: true,
          isActive: true,
        },
      },
    },
  },
} as const;

type LineRow = {
  id: string;
  variantId: string;
  quantity: number;
  variant: {
    size: string;
    colorName: string;
    colorHex: string;
    sku: string;
    price: unknown;
    stock: number;
    isActive: boolean;
    product: {
      slug: string;
      title: string;
      images: string[];
      basePrice: unknown;
      isActive: boolean;
    };
  };
};

function toLine(row: LineRow): CartLine {
  const { variant } = row;
  const unitPrice = toStorage(String(variant.price ?? variant.product.basePrice));
  const purchasable = variant.isActive && variant.product.isActive;

  const issue: LineIssue | null = !purchasable
    ? "UNAVAILABLE"
    : variant.stock <= 0
      ? "OUT_OF_STOCK"
      : variant.stock < row.quantity
        ? "INSUFFICIENT_STOCK"
        : null;

  return {
    id: row.id,
    variantId: row.variantId,
    productSlug: variant.product.slug,
    productTitle: variant.product.title,
    image: variant.product.images[0] ?? null,
    size: variant.size,
    colorName: variant.colorName,
    colorHex: variant.colorHex,
    sku: variant.sku,
    unitPrice,
    quantity: row.quantity,
    lineTotal: toStorage(mul(unitPrice, row.quantity)),
    available: variant.stock,
    issue,
  };
}

function toView(id: string | null, rows: LineRow[]): CartView {
  const lines = rows.map(toLine);
  return {
    id,
    currency: serverEnv().BASE_CURRENCY,
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    subtotal: toStorage(sum(lines.map((line) => line.lineTotal))),
    hasIssues: lines.some((line) => line.issue !== null),
  };
}

const EMPTY_ORDER = [{ createdAt: "asc" as const }, { id: "asc" as const }];

/** Reads the owner's cart without creating one. */
export async function getCartView(owner: CartOwner | null): Promise<CartView> {
  if (!owner) return toView(null, []);

  const cart = await prisma.cart.findFirst({
    where: cartWhere(owner),
    select: { id: true, items: { select: LINE_SELECT, orderBy: EMPTY_ORDER } },
  });

  return toView(cart?.id ?? null, cart?.items ?? []);
}

/** Cheap count for the header badge — no joins, no price resolution. */
export async function getCartItemCount(owner: CartOwner | null): Promise<number> {
  if (!owner) return 0;
  const result = await prisma.cartItem.aggregate({
    where: { cart: cartWhere(owner) },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

/**
 * One cart per user and one per guest cookie, enforced by unique constraints.
 * Two parallel "add to cart" clicks can both find nothing and both insert; the
 * loser of that race gets P2002 and reads the winner's row.
 */
export async function getOrCreateCart(owner: CartOwner): Promise<string> {
  const where = cartWhere(owner);
  const existing = await prisma.cart.findFirst({ where, select: { id: true } });
  if (existing) return existing.id;

  try {
    const created = await prisma.cart.create({ data: where, select: { id: true } });
    return created.id;
  } catch {
    const raced = await prisma.cart.findFirst({ where, select: { id: true } });
    if (raced) return raced.id;
    throw new Error("Could not open a cart.");
  }
}

export type AddResult =
  | { ok: true; cart: CartView }
  | { ok: false; reason: "NOT_FOUND" | "UNAVAILABLE" | "OUT_OF_STOCK" };

/**
 * Adds to an existing line rather than creating a duplicate, so a cart holds
 * one row per variant and the guest-merge below is a simple sum.
 *
 * The quantity is clamped to stock on hand. That is a courtesy, not a
 * reservation: stock is only truly claimed inside the verified-paid
 * transaction (SEC-19), and anything else would let an unpaid cart strand
 * inventory.
 */
export async function addItem(
  owner: CartOwner,
  variantId: string,
  quantity: number,
): Promise<AddResult> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      stock: true,
      isActive: true,
      product: { select: { isActive: true } },
    },
  });

  if (!variant) return { ok: false, reason: "NOT_FOUND" };
  if (!variant.isActive || !variant.product.isActive) {
    return { ok: false, reason: "UNAVAILABLE" };
  }
  if (variant.stock <= 0) return { ok: false, reason: "OUT_OF_STOCK" };

  const cartId = await getOrCreateCart(owner);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
    select: { quantity: true },
  });

  const requested = (existing?.quantity ?? 0) + quantity;
  const clamped = Math.max(1, Math.min(requested, variant.stock, MAX_LINE_QUANTITY));

  await prisma.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, quantity: clamped },
    update: { quantity: clamped },
  });

  return { ok: true, cart: await getCartView(owner) };
}

/**
 * Quantity changes and removals are `updateMany`/`deleteMany` filtered by the
 * owner's cart, so an item id belonging to somebody else's cart matches zero
 * rows instead of being fetched and then checked (SEC-23).
 */
export async function updateItemQuantity(
  owner: CartOwner,
  itemId: string,
  quantity: number,
): Promise<{ ok: boolean; cart: CartView }> {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: cartWhere(owner) },
    select: { id: true, variant: { select: { stock: true } } },
  });

  if (!item) return { ok: false, cart: await getCartView(owner) };

  const clamped = Math.max(
    1,
    Math.min(quantity, Math.max(item.variant.stock, 1), MAX_LINE_QUANTITY),
  );
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: clamped } });

  return { ok: true, cart: await getCartView(owner) };
}

export async function removeItem(
  owner: CartOwner,
  itemId: string,
): Promise<{ ok: boolean; cart: CartView }> {
  const result = await prisma.cartItem.deleteMany({
    where: { id: itemId, cart: cartWhere(owner) },
  });
  return { ok: result.count > 0, cart: await getCartView(owner) };
}

/** Emptied on a successful capture, so a paid cart cannot be checked out twice. */
export async function clearCart(cartId: string): Promise<void> {
  await prisma.cartItem.deleteMany({ where: { cartId } });
}

/**
 * Guest → user merge, called on login (F3).
 *
 * Quantities are summed per variant and clamped to stock, then the guest cart
 * is deleted so the anonymous identity owns nothing afterwards (SEC-23). The
 * cookie itself is cleared by the caller, which holds the response.
 *
 * A failure here must not fail the login: the shopper is authenticated either
 * way, and a lost guest cart is an annoyance, not a security event.
 */
export async function mergeGuestCart(userId: string, guestId: string): Promise<void> {
  try {
    const guestCart = await prisma.cart.findUnique({
      where: { guestId },
      select: {
        id: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            variant: { select: { stock: true, isActive: true } },
          },
        },
      },
    });

    if (!guestCart) return;

    if (guestCart.items.length > 0) {
      const userCartId = await getOrCreateCart({ kind: "user", userId });
      const existing = await prisma.cartItem.findMany({
        where: { cartId: userCartId },
        select: { variantId: true, quantity: true },
      });
      const held = new Map(existing.map((item) => [item.variantId, item.quantity]));

      for (const item of guestCart.items) {
        if (!item.variant.isActive || item.variant.stock <= 0) continue;
        const merged = (held.get(item.variantId) ?? 0) + item.quantity;
        const clamped = Math.max(
          1,
          Math.min(merged, item.variant.stock, MAX_LINE_QUANTITY),
        );
        await prisma.cartItem.upsert({
          where: { cartId_variantId: { cartId: userCartId, variantId: item.variantId } },
          create: { cartId: userCartId, variantId: item.variantId, quantity: clamped },
          update: { quantity: clamped },
        });
      }
    }

    await prisma.cart.delete({ where: { id: guestCart.id } });
  } catch (error) {
    console.error("[cart] guest merge failed", error);
  }
}
