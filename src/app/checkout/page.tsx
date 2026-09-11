import type { Metadata } from "next";
import Link from "next/link";
import { requireCheckoutUser } from "@/lib/auth/current-user";
import { getCartView } from "@/server/cart/service";
import { listAddresses } from "@/server/addresses/service";
import { activeProvider } from "@/server/payments";
import { buildQuote } from "@/server/pricing/quote";
import { CheckoutClient } from "./checkout-client";

/** Never indexed (spec §7). */
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Checkout (F3).
 *
 * Gated on a session always, and on a **verified** email address by default:
 * an order whose buyer cannot be emailed has no way to receive a confirmation
 * or a refund notice, which makes every downstream failure unresolvable.
 * `REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT="false"` lifts the second half for a
 * store whose mail does not yet deliver — there the gate strands the shopper
 * at a link that never arrives instead of protecting them. Either way this
 * redirects rather than rendering a dead end.
 *
 * The totals rendered here are a quote. They are recomputed from the database
 * when the order is created, and the payment provider is given that figure —
 * never one that passed through the browser (SEC-4, SEC-11).
 */
export default async function CheckoutPage() {
  const user = await requireCheckoutUser();

  const [cart, addresses] = await Promise.all([
    getCartView({ kind: "user", userId: user.id }),
    listAddresses(user.id),
  ]);

  // Quoting the default address on the server means the first paint carries a
  // real total instead of a spinner — and it is the same buildQuote the order
  // is written from, so there is one implementation of the pricing rule, not
  // two (SEC-4).
  const defaultAddress = addresses[0];
  const initialQuote = defaultAddress
    ? await buildQuote({
        lines: cart.lines.map((line) => ({
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        })),
        country: defaultAddress.country,
      })
    : null;

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 py-4">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Your cart is empty, so there is nothing to check out.
        </p>
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
    <div className="flex flex-col gap-8 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Paying with {activeProvider().label}. Your card or wallet details are entered on
          the provider&rsquo;s own page — this store never sees them.
        </p>
      </header>

      <CheckoutClient
        cart={cart}
        initialAddresses={addresses}
        initialQuote={initialQuote}
        providerLabel={activeProvider().label}
      />
    </div>
  );
}
