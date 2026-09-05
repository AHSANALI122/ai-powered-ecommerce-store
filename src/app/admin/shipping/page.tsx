import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { serverEnv } from "@/lib/env";
import { listShippingZones } from "@/server/admin/shipping";
import { ShippingManager } from "./shipping-manager";

export const metadata: Metadata = { title: "Shipping" };
export const dynamic = "force-dynamic";

/**
 * Shipping zones and rates.
 *
 * Checkout resolves a zone by the destination country and falls back to the
 * catch-all (`*`) when no explicit zone lists it. Without an active catch-all
 * and at least one active rate in it, a shopper in an unlisted country reaches
 * the shipping step with nothing to choose — so the screen says so rather than
 * leaving it to be discovered by a customer.
 */
export default async function AdminShippingPage() {
  await requireRole("STAFF", "ADMIN");

  const overview = await listShippingZones();
  const currency = serverEnv().BASE_CURRENCY;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Shipping</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          A destination matches the first zone that lists its country; the zone with
          countries <code>*</code> catches everything else. Rates are in {currency}.
        </p>
      </div>

      {!overview.hasActiveCatchAll ? (
        <p
          role="status"
          className="rounded-md border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-sm"
        >
          No active catch-all zone with an active rate. Shoppers in countries no zone
          lists will not be able to complete checkout.
        </p>
      ) : null}

      <ShippingManager overview={overview} currency={currency} />
    </div>
  );
}
