"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { apiFetch } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import { useCartStore, type CartResponse } from "@/stores/cart";
import { buttonClass, surfaceClass } from "@/components/ui/button";

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
  canCheckOut,
}: {
  initialCart: Cart;
  isSignedIn: boolean;
  /**
   * Decided on the server, because whether an unverified address may buy is
   * policy the checkout page and the checkout POST also enforce. Passing the
   * raw `emailVerified` here would leave this button free to disagree with
   * them.
   */
  canCheckOut: boolean;
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
      <div
        className={surfaceClass(
          "animate-fade-up flex flex-col items-center gap-4 px-8 py-16 text-center",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-[var(--color-subtle)] text-2xl"
        >
          🧺
        </span>
        <p className="font-display text-xl font-semibold">Your cart is empty</p>
        <p className="max-w-sm text-sm text-[var(--color-muted)]">
          Nothing is reserved until a payment is confirmed, so anything you add here is
          still yours to change.
        </p>
        <Link href="/" className={buttonClass({ size: "lg" })}>
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
            className={surfaceClass(
              `group animate-fade-up flex gap-3 p-3 transition-opacity duration-200 sm:gap-4 sm:p-4 ${
                pending && busyLine === line.id ? "opacity-60" : ""
              }`,
            )}
          >
            <Link
              href={runtimeRoute(`/p/${line.productSlug}`)}
              className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-[var(--color-subtle)] sm:size-24"
            >
              {line.image ? (
                <Image
                  src={line.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 80px, 96px"
                  className="object-cover transition-transform duration-500 ease-[var(--ease-entrance)] group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              ) : null}
            </Link>

            <div className="flex flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={runtimeRoute(`/p/${line.productSlug}`)}
                    className="link-sweep font-medium"
                  >
                    {line.productTitle}
                  </Link>
                  <p className="text-sm text-[var(--color-muted)]">
                    {line.colorName} · {line.size} · SKU {line.sku}
                  </p>
                </div>
                <p className="font-medium tabular-nums">
                  {formatMoney(line.lineTotal, cart.currency)}
                </p>
              </div>

              {line.issue ? (
                <p className="animate-fade-in text-sm text-red-600">
                  {ISSUE_LABEL[line.issue]}
                  {line.issue === "INSUFFICIENT_STOCK"
                    ? ` — only ${line.available} left.`
                    : "."}
                </p>
              ) : null}

              {/* Wraps on a phone: a stepper, a unit price and a remove
                  control are about 300px of content inside a row that has
                  ~230px once the thumbnail and the card padding are taken. The
                  remove link keeps `ml-auto` so it stays right-aligned on the
                  row it lands on. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* A stepper rather than a number input: the two operations a
                    shopper actually performs on a cart line are "one more" and
                    "one fewer", and each is a labelled button a screen reader
                    can announce. The count between them is the live region, so
                    a change is spoken without moving focus. */}
                <div className="flex items-center gap-1 rounded-full border border-[var(--color-line)] p-0.5">
                  <button
                    type="button"
                    onClick={() => changeQuantity(line, line.quantity - 1)}
                    disabled={line.quantity <= 1 || (pending && busyLine === line.id)}
                    aria-label={`Reduce quantity of ${line.productTitle}`}
                    className="flex size-9 items-center justify-center rounded-full text-base transition-colors duration-200 hover:bg-[var(--color-subtle)] disabled:opacity-35 sm:size-7 sm:text-sm"
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  <span
                    aria-live="polite"
                    className="min-w-6 text-center text-sm tabular-nums"
                  >
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => changeQuantity(line, line.quantity + 1)}
                    disabled={
                      line.quantity >= Math.max(line.available, 1) ||
                      (pending && busyLine === line.id)
                    }
                    aria-label={`Increase quantity of ${line.productTitle}`}
                    className="flex size-9 items-center justify-center rounded-full text-base transition-colors duration-200 hover:bg-[var(--color-subtle)] disabled:opacity-35 sm:size-7 sm:text-sm"
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
                <span className="text-sm text-[var(--color-muted)] tabular-nums">
                  {formatMoney(line.unitPrice, cart.currency)} each
                </span>
                <button
                  type="button"
                  onClick={() => remove(line)}
                  disabled={pending && busyLine === line.id}
                  className="link-sweep ml-auto text-sm text-[var(--color-muted)] transition-colors duration-200 hover:text-[var(--color-ink)] disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside
        className={surfaceClass(
          "flex w-full flex-col gap-4 p-5 sm:p-6 lg:sticky lg:top-28 lg:w-80",
        )}
      >
        <h2 className="font-display text-lg font-semibold">Summary</h2>

        <div className="flex justify-between text-sm">
          <span className="text-[var(--color-muted)]">
            Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? "" : "s"})
          </span>
          <span className="text-base font-medium tabular-nums">
            {formatMoney(cart.subtotal, cart.currency)}
          </span>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Shipping and tax are calculated at checkout, once a delivery address is chosen.
        </p>

        {error ? (
          <p role="alert" className="animate-fade-up text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {cart.hasIssues ? (
          <p className="animate-fade-up rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            Remove or reduce the flagged items before checking out.
          </p>
        ) : null}

        {!isSignedIn ? (
          <Link
            href="/login?next=%2Fcheckout"
            className={buttonClass({ size: "lg", className: "w-full" })}
          >
            Sign in to check out
          </Link>
        ) : !canCheckOut ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-muted)]">
              Confirm your email address to check out.
            </p>
            <Link
              href="/account"
              className={buttonClass({
                variant: "secondary",
                size: "lg",
                className: "w-full",
              })}
            >
              Go to your account
            </Link>
          </div>
        ) : (
          <Link
            href="/checkout"
            aria-disabled={cart.hasIssues}
            className={buttonClass({
              size: "lg",
              className: cart.hasIssues
                ? "pointer-events-none w-full opacity-50"
                : "w-full",
            })}
          >
            Check out
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </aside>
    </div>
  );
}
