"use client";

import { useEffect, useRef, useState } from "react";
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
 *
 * The badge pops when the number goes up — including when the assistant is
 * what added the item, which is the one case where the change happens far from
 * the shopper's cursor and would otherwise be easy to miss. It fires only on
 * an increase, and never on the first load, or every page view would end with
 * the header twitching for no reason.
 */
export function CartLink() {
  const itemCount = useCartStore((state) => state.itemCount);
  const status = useCartStore((state) => state.status);
  const setCount = useCartStore((state) => state.setCount);

  const [bumping, setBumping] = useState(false);
  const previous = useRef<number | null>(null);

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

  useEffect(() => {
    if (status !== "ready") return;
    const before = previous.current;
    previous.current = itemCount;
    if (before === null || itemCount <= before) return;

    setBumping(true);
    const timer = window.setTimeout(() => setBumping(false), 400);
    return () => window.clearTimeout(timer);
  }, [itemCount, status]);

  return (
    <Link
      href="/cart"
      className="group flex items-center gap-2 text-sm transition-opacity hover:opacity-70"
    >
      <span className="relative inline-flex">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 7h12l-1 12H7L6 7Z" />
          <path d="M9 7a3 3 0 0 1 6 0" />
        </svg>
        {status === "ready" && itemCount > 0 ? (
          <span
            // Keyed on the count so React remounts it on every change; an
            // animation class re-applied to the same element would not replay.
            key={itemCount}
            className={`absolute -right-2 -top-2 min-w-4 rounded-full bg-[var(--color-accent)] px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-[var(--color-accent-ink)] ${
              bumping ? "animate-pop" : ""
            }`}
            aria-label={`${itemCount} item${itemCount === 1 ? "" : "s"} in cart`}
          >
            {itemCount}
          </span>
        ) : null}
      </span>
      <span className="hidden sm:inline">Cart</span>
    </Link>
  );
}
