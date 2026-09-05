"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import { useCartStore, type CartResponse } from "@/stores/cart";

type Cart = CartResponse["cart"];
type Line = Cart["lines"][number];

/**
 * Cart editing.
 *
 * Every mutation returns the whole recomputed cart, and this component simply
 * renders whatever came back. There is no local arithmetic: a client that adds
 * up its own totals is a client whose totals can disagree with the server's,
 * and the server's are the only ones that will ever be charged (SEC-4).
 *
 * Lines the server flagged are shown with the reason and block checkout. They
 * are not silently removed — a shopper who came back to find an item gone with
 * no explanation has no idea what happened.
 */
const ISSUE_LABEL: Record<NonNullable<Line["issue"]>, string> = {
  UNAVAILABLE: "No longer available",
  OUT_OF_STOCK: "Sold out",
  INSUFFICIENT_STOCK: "Not enough left in stock",
};

export function CartClient({
  initialCart,
  isSignedIn,
  isVerified,
}: {
  initialCart: Cart;
  isSignedIn: boolean;
  isVerified: boolean;
}) {
  const [cart, setCart] = useState<Cart>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const setCount = useCartStore((state) => state.setCount);

  // Keep the header badge honest when this page is the first thing loaded.
  useEffect(() => {
    setCount(initialCart.itemCount);
  }, [initialCart.itemCount, setCount]);

  function mutate(path: string, init: RequestInit, lineId: string) {
    setError(null);
    setBusyLine(lineId);
    startTransition(async () => {
      const result = await apiFetch<CartResponse>(path, init);
      setBusyLine(null);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCart(result.data.cart);
      setCount(result.data.cart.itemCount);
    });
  }

  function changeQuantity(line: Line, quantity: number) {
    mutate(
      `/api/cart/items/${line.id}`,
      { method: "PATCH", body: JSON.stringify({ quantity }) },
      line.id,
    );
  }

  function remove(line: Line) {
    mutate(`/api/cart/items/${line.id}`, { method: "DELETE" }, line.id);
  }

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-[var(--color-line)] p-8">
        <p className="text-sm text-[var(--color-muted)]">Your cart is empty.</p>
        <Link
          href="/"
          className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)]"
        >
          Browse the catalogue
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <ul className="flex flex-1 flex-col gap-4">
        {cart.lines.map((line) => (
          <li
            key={line.id}
            className="flex gap-4 rounded-lg border border-[var(--color-line)] p-4"
          >
            <Link
              href={runtimeRoute(`/p/${line.productSlug}`)}
              className="relative size-24 shrink-0 overflow-hidden rounded-md bg-black/[0.03]"
            >
              {line.image ? (
                <Image
                  src={line.image}
                  alt=""
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              ) : null}
            </Link>

            <div className="flex flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={runtimeRoute(`/p/${line.productSlug}`)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {line.productTitle}
                  </Link>
                  <p className="text-sm text-[var(--color-muted)]">
                    {line.colorName} · {line.size} · SKU {line.sku}
                  </p>
                </div>
                <p className="tabular-nums">
                  {formatMoney(line.lineTotal, cart.currency)}
                </p>
              </div>

              {line.issue ? (
                <p className="text-sm text-red-600">
                  {ISSUE_LABEL[line.issue]}
                  {line.issue === "INSUFFICIENT_STOCK"
                    ? ` — only ${line.available} left.`
                    : "."}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--color-muted)]">Qty</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(line.available, 1)}
                    value={line.quantity}
                    disabled={pending && busyLine === line.id}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next) && next >= 1) {
                        changeQuantity(line, next);
                      }
                    }}
                    className="w-16 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm tabular-nums"
                  />
                </label>
                <span className="text-sm text-[var(--color-muted)] tabular-nums">
                  {formatMoney(line.unitPrice, cart.currency)} each
                </span>
                <button
                  type="button"
                  onClick={() => remove(line)}
                  disabled={pending && busyLine === line.id}
                  className="ml-auto text-sm text-[var(--color-muted)] underline underline-offset-4 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside className="flex w-full flex-col gap-4 rounded-lg border border-[var(--color-line)] p-6 lg:w-80">
        <h2 className="text-lg font-medium">Summary</h2>

        <div className="flex justify-between text-sm">
          <span className="text-[var(--color-muted)]">
            Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? "" : "s"})
          </span>
          <span className="tabular-nums">
            {formatMoney(cart.subtotal, cart.currency)}
          </span>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Shipping and tax are calculated at checkout, once a delivery address is chosen.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {cart.hasIssues ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            Remove or reduce the flagged items before checking out.
          </p>
        ) : null}

        {!isSignedIn ? (
          <Link
            href="/login?next=%2Fcheckout"
            className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-center text-sm font-medium text-[var(--color-surface)]"
          >
            Sign in to check out
          </Link>
        ) : !isVerified ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-muted)]">
              Confirm your email address to check out.
            </p>
            <Link
              href="/account"
              className="rounded-md border border-[var(--color-line)] px-4 py-2 text-center text-sm font-medium"
            >
              Go to your account
            </Link>
          </div>
        ) : (
          <Link
            href="/checkout"
            aria-disabled={cart.hasIssues}
            className={
              cart.hasIssues
                ? "pointer-events-none rounded-md bg-[var(--color-ink)] px-4 py-2 text-center text-sm font-medium text-[var(--color-surface)] opacity-50"
                : "rounded-md bg-[var(--color-ink)] px-4 py-2 text-center text-sm font-medium text-[var(--color-surface)]"
            }
          >
            Check out
          </Link>
        )}
      </aside>
    </div>
  );
}
