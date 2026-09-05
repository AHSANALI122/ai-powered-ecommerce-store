import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { addItem, type AddResult } from "@/server/cart/service";
import type { MoveToCartInput } from "@/lib/validation/wishlist";

/**
 * Wishlist service (F6).
 *
 * Every function takes `userId` as its first argument and puts it in the
 * `where` clause of the query itself, never in a check after the fetch
 * (SEC-23). There is no guest wishlist: a cart survives on a cookie because it
 * has to — a shopper must be able to fill one before deciding to sign up — but
 * a saved list is only useful across devices, which is to say only useful with
 * an account.
 */

/** Cap on stored entries. An unbounded per-user list is free storage growth. */
export const WISHLIST_MAX_ITEMS = 200;

export interface WishlistEntry {
  productId: string;
  slug: string;
  title: string;
  brand: string | null;
  image: string | null;
  /** As a string: money never passes through a JS number (AD-6). */
  price: string;
  ratingAvg: string;
  ratingCount: number;
  inStock: boolean;
  /** Pre-resolved default for "move to cart"; null when nothing is buyable. */
  defaultVariantId: string | null;
  addedAt: Date;
}

/**
 * The caller's list, newest first.
 *
 * `isActive` is *not* a filter here. A product withdrawn from sale should
 * still appear on the list that says "you wanted this" — showing it as
 * unavailable is information, silently dropping it looks like data loss. It is
 * `inStock: false` with no default variant, so nothing can be moved to a cart
 * from it, which is where the rule actually needs enforcing.
 */
export async function listWishlist(userId: string): Promise<WishlistEntry[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: WISHLIST_MAX_ITEMS,
    select: {
      createdAt: true,
      product: {
        select: {
          id: true,
          slug: true,
          title: true,
          brand: true,
          images: true,
          basePrice: true,
          ratingAvg: true,
          ratingCount: true,
          isActive: true,
          variants: {
            where: { isActive: true },
            orderBy: [{ stock: "desc" }, { position: "asc" }],
            select: { id: true, price: true, stock: true },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const product = row.product;
    // Ordered stock-first above, so the head is the best candidate to buy.
    const best = product.variants[0];
    const buyable = product.isActive && best !== undefined && best.stock > 0;

    return {
      productId: product.id,
      slug: product.slug,
      title: product.title,
      brand: product.brand,
      image: product.images[0] ?? null,
      // The variant's own price when it overrides, else the product's base
      // price — the same resolution the product page uses (AD-5).
      price: (best?.price ?? product.basePrice).toString(),
      ratingAvg: product.ratingAvg.toString(),
      ratingCount: product.ratingCount,
      inStock: buyable,
      defaultVariantId: buyable ? best.id : null,
      addedAt: row.createdAt,
    };
  });
}

/** Product ids on the caller's list, for marking hearts on a listing page. */
export async function listWishlistProductIds(userId: string): Promise<string[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId },
    select: { productId: true },
  });
  return rows.map((row) => row.productId);
}

export type WishlistAddResult =
  | { ok: true; added: boolean }
  | { ok: false; reason: "NOT_FOUND" | "LIMIT" };

/**
 * Adds a product to the list.
 *
 * Idempotent: adding twice reports `added: false` rather than failing, because
 * the meaningful state is "on the list", and a double-tapped heart is not an
 * error the shopper should have to see. The unique constraint is still what
 * enforces it — a P2002 from a concurrent double-tap is caught, not
 * pre-empted by a read that would race.
 */
export async function addToWishlist(
  userId: string,
  productId: string,
): Promise<WishlistAddResult> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) return { ok: false, reason: "NOT_FOUND" };

  const count = await prisma.wishlistItem.count({ where: { userId } });
  if (count >= WISHLIST_MAX_ITEMS) return { ok: false, reason: "LIMIT" };

  try {
    await prisma.wishlistItem.create({ data: { userId, productId: product.id } });
    return { ok: true, added: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true, added: false };
    }
    throw error;
  }
}

/**
 * Removes a product from the caller's list. `deleteMany` scoped to the owner:
 * a product id that is on somebody else's list matches zero rows here, which
 * is the same outcome as one that is on nobody's (SEC-23).
 */
export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<boolean> {
  const deleted = await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  return deleted.count > 0;
}

/**
 * Moves a wishlisted product into the cart.
 *
 * The variant is resolved here rather than trusted from the body. A supplied
 * `variantId` is looked up **with `productId` in the same `where`**, so a
 * variant of some other product cannot be smuggled in under the wishlisted
 * product's id; an absent one is chosen as the first in-stock active variant.
 * Either way `addItem` re-checks availability, because between choosing a
 * variant and adding it the stock can change — and stock is only truly claimed
 * inside the verified-paid transaction anyway (SEC-19).
 *
 * The wishlist row is removed only after the cart write succeeds. "Move" that
 * empties the list and then fails to add is the one ordering a shopper cannot
 * recover from.
 */
export async function moveToCart(
  userId: string,
  input: MoveToCartInput,
): Promise<AddResult> {
  const onList = await prisma.wishlistItem.findUnique({
    where: { userId_productId: { userId, productId: input.productId } },
    select: { productId: true },
  });
  if (!onList) return { ok: false, reason: "NOT_FOUND" };

  const variant = await prisma.productVariant.findFirst({
    where: {
      productId: input.productId,
      isActive: true,
      product: { isActive: true },
      ...(input.variantId ? { id: input.variantId } : { stock: { gt: 0 } }),
    },
    orderBy: [{ stock: "desc" }, { position: "asc" }],
    select: { id: true },
  });
  if (!variant) {
    // No active variant with stock, or a variantId that is not this product's.
    return { ok: false, reason: input.variantId ? "NOT_FOUND" : "OUT_OF_STOCK" };
  }

  const result = await addItem({ kind: "user", userId }, variant.id, input.quantity);
  if (!result.ok) return result;

  await prisma.wishlistItem.deleteMany({ where: { userId, productId: input.productId } });
  return result;
}
