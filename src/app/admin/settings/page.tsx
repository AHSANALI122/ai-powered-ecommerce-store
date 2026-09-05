import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { serverEnv } from "@/lib/env";
import { readTaxRateSetting } from "@/server/admin/settings";
import { TaxRateForm } from "./tax-rate-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Store settings. ADMIN only — the guard here and the guard on the PATCH
 * handler both check the role against the database (SEC-7).
 */
export default async function AdminSettingsPage() {
  await requireRole("ADMIN");

  const env = serverEnv();
  const tax = await readTaxRateSetting();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Runtime settings override their environment defaults without a redeploy. They
          are read fresh on every quote, never from a cross-request cache, so a change
          cannot be applied to a charge after it was reversed.
        </p>
      </div>

      <TaxRateForm tax={tax} />

      <section className="rounded-lg border border-[var(--color-line)] p-4 text-sm">
        <h3 className="font-medium">Fixed at deploy time</h3>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          These come from the environment and cannot be changed from the dashboard — a
          payment provider or a base currency changed mid-flight would strand in-progress
          orders.
        </p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <Row label="Base currency" value={env.BASE_CURRENCY} />
          <Row label="Payment provider" value={env.PAYMENT_PROVIDER} />
          <Row label="Order expiry" value={`${env.ORDER_EXPIRY_MINUTES} minutes`} />
          <Row label="Image store" value={env.IMAGE_STORE} />
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--color-line)] pb-1">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}
