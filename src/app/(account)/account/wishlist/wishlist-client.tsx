"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { useCartStore, type CartResponse } from "@/stores/cart";
import type { WishlistEntry } from "@/server/wishlist/service";

/**
 * The wishlist grid (F6).
 *
 * Two actions per row, and the interesting one is "move to cart". It sends a
 * product id and — when the server pre-resolved one — a variant id, but the
 * server re-resolves the variant against the wishlisted product regardless and
 * re-checks stock through the ordinary cart path. So a stale
 * `defaultVariantId` rendered minutes ago cannot add something unbuyable; it
 * just gets a "sold out" back.
 *
 * `router.refresh()` after either action re-reads the list on the server
 * rather than splicing local state, which keeps this component from
 * accumulating its own idea of what is saved.
 */
export function WishlistClient({
  items,
  currency,
}: {
  items: WishlistEntry[];
  currency: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const setCount = useCartStore((state) => state.setCount);

  function remove(productId: string) {
    setError(null);
    setPendingId(productId);
    startTransition(async () => {
      const result = await apiFetch<{ ok: boolean }>(`/api/wishlist/${productId}`, {
        method: "DELETE",
      });
      setPendingId(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function move(entry: WishlistEntry) {
    setError(null);
    setPendingId(entry.productId);
    startTransition(async () => {
      const result = await postJson<CartResponse>("/api/wishlist/move-to-cart", {
        productId: entry.productId,
        ...(entry.defaultVariantId ? { variantId: entry.defaultVariantId } : {}),
        quantity: 1,
      });
      setPendingId(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCount(result.data.cart.itemCount);
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        Nothing saved yet.{" "}
        <Link href="/" className="underline underline-offset-4">
          Browse the collection
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => {
          const busy = pendingId === item.productId;
          return (
            <li key={item.productId} className="flex flex-col gap-3">
              <Link
                href={`/p/${item.slug}`}
                className="group relative block aspect-3/4 overflow-hidden rounded-lg bg-black/5"
              >
                {item.image ? (
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    loading="lazy"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                ) : null}
                {!item.inStock ? (
                  <span className="absolute left-2 top-2 rounded bg-[var(--color-ink)]/85 px-2 py-0.5 text-xs text-[var(--color-surface)]">
                    Unavailable
                  </span>
                ) : null}
              </Link>

              <div className="flex flex-col gap-1">
                <Link
                  href={`/p/${item.slug}`}
                  className="text-sm font-medium hover:underline"
                >
                  {item.title}
                </Link>
                {item.brand ? (
                  <p className="text-xs text-[var(--color-muted)]">{item.brand}</p>
                ) : null}
                <p className="text-sm tabular-nums">{formatMoney(item.price, currency)}</p>
              </div>

              <div className="mt-auto flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => move(item)}
                  disabled={busy || !item.inStock}
                  className="rounded-md bg-[var(--color-ink)] px-3 py-2 text-xs font-medium text-[var(--color-surface)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Working…" : item.inStock ? "Move to cart" : "Sold out"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(item.productId)}
                  disabled={busy}
                  className="text-xs text-[var(--color-muted)] underline underline-offset-4 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
