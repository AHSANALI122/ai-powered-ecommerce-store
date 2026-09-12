"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { AddressForm, type Address } from "@/components/account/address-form";
import type { CartResponse } from "@/stores/cart";

type Cart = CartResponse["cart"];

interface ShippingOption {
  id: string;
  name: string;
  zoneName: string;
  price: string;
  freeOver: string | null;
  minDays: number;
  maxDays: number;
}

interface Quote {
  currency: string;
  subtotal: string;
  shippingTotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  shippingWaived: boolean;
  shipping: ShippingOption | null;
  options: ShippingOption[];
  taxRate: string;
}

type Redirect =
  | { method: "GET"; url: string }
  | { method: "POST"; url: string; fields: Record<string, string> };

/**
 * The checkout screen.
 *
 * Two things it deliberately does not do:
 *
 *  1. **It never computes a total.** Every figure shown comes from
 *     `/api/checkout/quote`, which runs the same `buildQuote` the order is
 *     written from. If this component did its own arithmetic, the number on
 *     screen and the number charged would be two independent implementations
 *     of the same rule — and one of them would eventually be wrong (SEC-4).
 *  2. **It never sends an amount.** The request carries an address id and a
 *     shipping rate id. There is no price field to tamper with.
 *
 * The idempotency key is what makes a double-click safe (SEC-20). It is
 * regenerated whenever the address or shipping choice changes, because that is
 * a *different* order — reusing the key there would replay the previous one
 * and quietly ship to the wrong address.
 */
export function CheckoutClient({
  cart,
  initialAddresses,
  initialQuote,
  providerLabel,
}: {
  cart: Cart;
  initialAddresses: Address[];
  initialQuote: Quote | null;
  providerLabel: string;
}) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [addressId, setAddressId] = useState(initialAddresses[0]?.id ?? "");
  const [shippingRateId, setShippingRateId] = useState(initialQuote?.shipping?.id ?? "");
  const [showForm, setShowForm] = useState(initialAddresses.length === 0);
  const [quote, setQuote] = useState<Quote | null>(initialQuote);
  const [error, setError] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  const [placing, startPlace] = useTransition();
  const idempotencyKey = useRef(crypto.randomUUID());

  // A new attempt for a new configuration. See the note above.
  useEffect(() => {
    idempotencyKey.current = crypto.randomUUID();
  }, [addressId, shippingRateId]);

  /**
   * Re-price against the server. Called from event handlers only — the first
   * quote is rendered on the server, so there is no "fetch on mount" effect
   * and no render where the total is unknown.
   */
  function refreshQuote(nextAddressId: string, nextRateId: string) {
    if (!nextAddressId) return;
    setError(null);

    startQuote(async () => {
      const result = await postJson<{ quote: Quote }>("/api/checkout/quote", {
        addressId: nextAddressId,
        ...(nextRateId ? { shippingRateId: nextRateId } : {}),
      });

      if (!result.ok) {
        setQuote(null);
        setError(result.error.message);
        return;
      }

      setQuote(result.data.quote);
      // Adopt whichever rate the server actually applied, so the selected
      // radio and the priced rate can never disagree.
      setShippingRateId(result.data.quote.shipping?.id ?? "");
    });
  }

  function chooseAddress(id: string) {
    setAddressId(id);
    // A different destination is a different shipping zone: drop the old rate
    // rather than quoting a domestic price against an overseas address.
    setShippingRateId("");
    refreshQuote(id, "");
  }

  function chooseRate(id: string) {
    setShippingRateId(id);
    refreshQuote(addressId, id);
  }

  function onAddressSaved(address: Address) {
    setAddresses((current) => {
      const others = current.filter((entry) => entry.id !== address.id);
      return address.isDefault ? [address, ...others] : [...others, address];
    });
    setShowForm(false);
    chooseAddress(address.id);
  }

  /**
   * Hand the browser to the provider. A GET redirect is a location change; a
   * POST redirect is a real form submission, because that is what a hosted
   * checkout expects and an XHR cannot navigate the top-level document.
   */
  function followRedirect(redirect: Redirect) {
    if (redirect.method === "GET") {
      window.location.href = redirect.url;
      return;
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = redirect.url;
    form.style.display = "none";
    for (const [name, value] of Object.entries(redirect.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }

  function placeOrder() {
    if (!addressId || !shippingRateId) return;
    setError(null);

    startPlace(async () => {
      const result = await apiFetch<{ redirect: Redirect }>("/api/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ addressId, shippingRateId }),
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      followRedirect(result.data.redirect);
    });
  }

  const canPlace =
    Boolean(addressId) && Boolean(shippingRateId) && Boolean(quote) && !cart.hasIssues;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex flex-1 flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Delivery address</h2>

          {addresses.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {addresses.map((address) => (
                <li key={address.id}>
                  <label className="flex cursor-pointer gap-3 rounded-lg border border-[var(--color-line)] p-4 text-sm has-checked:border-[var(--color-ink)] has-checked:ring-1 has-checked:ring-[var(--color-ink)]">
                    <input
                      type="radio"
                      name="address"
                      value={address.id}
                      checked={addressId === address.id}
                      onChange={() => chooseAddress(address.id)}
                      className="mt-0.5 size-4"
                    />
                    <span>
                      <span className="block font-medium">{address.fullName}</span>
                      <span className="block text-[var(--color-muted)]">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}, {address.city}
                        {address.postalCode ? ` ${address.postalCode}` : ""},{" "}
                        {address.country}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}

          {showForm ? (
            <div className="rounded-lg border border-[var(--color-line)] p-4">
              <AddressForm
                onSaved={onAddressSaved}
                onCancel={addresses.length > 0 ? () => setShowForm(false) : undefined}
                submitLabel="Use this address"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="self-start text-sm underline underline-offset-4"
            >
              Add a different address
            </button>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Delivery method</h2>
          {!quote ? (
            <p className="text-sm text-[var(--color-muted)]">
              {quoting ? "Calculating…" : "Choose an address to see delivery options."}
            </p>
          ) : quote.options.length === 0 ? (
            <p className="text-sm text-red-600">
              We do not currently deliver to that country.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {quote.options.map((option) => (
                <li key={option.id}>
                  <label className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-[var(--color-line)] p-4 text-sm has-checked:border-[var(--color-ink)] has-checked:ring-1 has-checked:ring-[var(--color-ink)]">
                    <input
                      type="radio"
                      name="shippingRate"
                      value={option.id}
                      checked={shippingRateId === option.id}
                      onChange={() => chooseRate(option.id)}
                      className="size-4"
                    />
                    <span className="flex-1">
                      <span className="block font-medium">{option.name}</span>
                      <span className="block text-[var(--color-muted)]">
                        {option.zoneName} · {option.minDays}–{option.maxDays} days
                        {option.freeOver
                          ? ` · free over ${formatMoney(option.freeOver, quote.currency)}`
                          : ""}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(option.price, quote.currency)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex w-full flex-col gap-4 rounded-lg border border-[var(--color-line)] p-5 sm:p-6 lg:sticky lg:top-28 lg:w-80">
        <h2 className="text-lg font-medium">Order summary</h2>

        <ul className="flex flex-col gap-2 text-sm">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-3">
              <span className="text-[var(--color-muted)]">
                {line.productTitle} · {line.colorName} {line.size} × {line.quantity}
              </span>
              <span className="tabular-nums">
                {formatMoney(line.lineTotal, cart.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-4 text-sm">
          <Row label="Subtotal" value={quote?.subtotal} currency={cart.currency} />
          <Row
            label={quote?.shippingWaived ? "Shipping (free)" : "Shipping"}
            value={quote?.shippingTotal}
            currency={cart.currency}
          />
          <Row
            label={`Tax${quote ? ` (${(Number(quote.taxRate) * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : ""}`}
            value={quote?.taxTotal}
            currency={cart.currency}
          />
          <div className="flex justify-between border-t border-[var(--color-line)] pt-2 text-base font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">
              {quote ? formatMoney(quote.grandTotal, quote.currency) : "—"}
            </dd>
          </div>
        </dl>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={placeOrder}
          disabled={!canPlace || placing || quoting}
          className="rounded-md bg-[var(--color-ink)] px-4 py-3 text-sm font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {placing ? "Redirecting…" : `Pay with ${providerLabel}`}
        </button>

        <p className="text-xs text-[var(--color-muted)]">
          Placing the order does not take stock. Your items are only claimed once the
          payment is confirmed by {providerLabel} — if that fails, nothing is charged and
          nothing is held.
        </p>
      </aside>
    </div>
  );
}

function Row({
  label,
  value,
  currency,
}: {
  label: string;
  value: string | undefined;
  currency: string;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="tabular-nums">{value ? formatMoney(value, currency) : "—"}</dd>
    </div>
  );
}
