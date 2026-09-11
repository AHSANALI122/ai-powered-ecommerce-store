import type { Metadata } from "next";
import { readCartOwner } from "@/server/cart/owner";
import { getCartView } from "@/server/cart/service";
import { canCheckOut, getCurrentUser } from "@/lib/auth/current-user";
import { CartClient } from "./cart-client";

/** A cart is one person's, and changes constantly. Never indexed (spec §7). */
export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The cart page (F3).
 *
 * Server-rendered from the database so the first paint carries real prices and
 * real availability, then handed to a client component for quantity edits.
 * Prices are resolved at render time, not stored on the cart row, so a price
 * change since the item was added shows up here rather than at the till
 * (SEC-11).
 */
export default async function CartPage() {
  const [cart, user] = await Promise.all([
    getCartView(await readCartOwner()),
    getCurrentUser(),
  ]);

  return (
    <div className="flex flex-col gap-8 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Prices and availability are re-checked when you check out. Nothing is reserved
          until a payment is confirmed.
        </p>
      </header>

      <CartClient
        initialCart={cart}
        isSignedIn={Boolean(user)}
        // The same question the checkout page and the checkout POST ask, so a
        // shopper is never shown a button that refuses them on the next screen.
        canCheckOut={canCheckOut(user)}
      />
    </div>
  );
}
