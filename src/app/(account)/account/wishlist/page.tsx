import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { serverEnv } from "@/lib/env";
import { listWishlist } from "@/server/wishlist/service";
import { WishlistClient } from "./wishlist-client";

export const metadata: Metadata = {
  title: "Your wishlist",
  // Account pages are noindex by policy (spec §7); this one would also be a
  // private list of what one person wants.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Wishlist (F6, SEC-23).
 *
 * `requireUser()` reads the row rather than trusting the JWT claim, and
 * `listWishlist` takes the id it returns — there is no path by which a
 * parameter could name whose list this is.
 */
export default async function WishlistPage() {
  const user = await requireUser();
  const items = await listWishlist(user.id);
  const currency = serverEnv().BASE_CURRENCY;

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your wishlist</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {items.length === 0
            ? "Save products here while you decide."
            : `${items.length} saved ${items.length === 1 ? "product" : "products"}. Prices and availability are live.`}
        </p>
      </header>

      <WishlistClient items={items} currency={currency} />
    </div>
  );
}
