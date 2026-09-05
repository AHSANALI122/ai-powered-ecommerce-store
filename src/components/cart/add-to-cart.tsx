"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { postJson } from "@/lib/client/api";
import { useCartStore, type CartResponse } from "@/stores/cart";

/**
 * Add-to-cart (F3).
 *
 * The request carries a variant id and a quantity — no price. The server reads
 * the price from the database, and would ignore one sent here anyway (SEC-4).
 *
 * The button is disabled for an unbuyable selection, but that is a courtesy:
 * the server re-checks the variant is active and in stock, because a disabled
 * button is not a control.
 */
export function AddToCart({
  variantId,
  disabled,
  disabledReason,
}: {
  variantId: string | null;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const setCount = useCartStore((state) => state.setCount);

  function submit() {
    if (!variantId) return;
    setError(null);
    setAdded(false);

    startTransition(async () => {
      const result = await postJson<CartResponse>("/api/cart/items", {
        variantId,
        quantity: 1,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCount(result.data.cart.itemCount);
      setAdded(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={submit}
        disabled={disabled || pending || !variantId}
        title={disabled ? disabledReason : undefined}
        className="rounded-md bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-[var(--color-surface)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add to cart"}
      </button>

      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : added ? (
          <span className="text-[var(--color-muted)]">
            Added.{" "}
            <Link href="/cart" className="underline underline-offset-4">
              View cart
            </Link>
          </span>
        ) : null}
      </p>
    </div>
  );
}
