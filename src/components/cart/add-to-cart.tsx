"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { postJson } from "@/lib/client/api";
import { useCartStore, type CartResponse } from "@/stores/cart";
import { buttonClass } from "@/components/ui/button";

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
        className={buttonClass({
          size: "lg",
          className: "w-full disabled:cursor-not-allowed",
        })}
      >
        {/* The spinner replaces the label rather than sitting beside it, so the
            button does not change width mid-request and shift the column. */}
        {pending ? (
          <>
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            Adding…
          </>
        ) : added ? (
          <>
            <span aria-hidden="true">✓</span>
            Added to cart
          </>
        ) : (
          "Add to cart"
        )}
      </button>

      {/* Reserves its line whether or not there is anything to say, so the
          layout under the button never jumps when a message appears (CLS). */}
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <span className="animate-fade-in text-red-600">{error}</span>
        ) : added ? (
          <span className="animate-fade-in text-[var(--color-muted)]">
            Added.{" "}
            <Link href="/cart" className="link-sweep font-medium text-[var(--color-ink)]">
              View cart
            </Link>
          </span>
        ) : null}
      </p>
    </div>
  );
}
