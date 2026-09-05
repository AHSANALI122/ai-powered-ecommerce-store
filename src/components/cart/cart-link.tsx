"use client";

import { useEffect } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { useCartStore, type CartResponse } from "@/stores/cart";

/**
 * The header cart link and its count.
 *
 * Fetched from the browser rather than rendered on the server, for the same
 * reason the account nav is (see session-loader.tsx): reading cookies in the
 * server tree would opt every catalogue page out of ISR. The badge is display
 * state; the cart itself is always re-read server-side (SEC-4).
 *
 * Nothing renders until the count is known, so a signed-in shopper with three
 * items never sees a "0" flash before it corrects itself.
 */
export function CartLink() {
  const itemCount = useCartStore((state) => state.itemCount);
  const status = useCartStore((state) => state.status);
  const setCount = useCartStore((state) => state.setCount);

  useEffect(() => {
    if (status !== "unknown") return;
    let cancelled = false;

    void (async () => {
      const result = await apiFetch<CartResponse>(
        "/api/cart",
        {},
        { retryOnUnauthorized: false },
      );
      if (cancelled) return;
      setCount(result.ok ? result.data.cart.itemCount : 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [status, setCount]);

  return (
    <Link
      href="/cart"
      className="flex items-center gap-1.5 text-sm underline underline-offset-4"
    >
      Cart
      {status === "ready" && itemCount > 0 ? (
        <span
          className="min-w-5 rounded-full bg-[var(--color-ink)] px-1.5 py-0.5 text-center text-xs font-medium tabular-nums text-[var(--color-surface)]"
          aria-label={`${itemCount} item${itemCount === 1 ? "" : "s"} in cart`}
        >
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
}
