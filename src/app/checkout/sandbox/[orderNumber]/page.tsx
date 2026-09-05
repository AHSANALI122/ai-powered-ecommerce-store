import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/auth/current-user";
import { getOrder } from "@/server/orders/queries";
import { SandboxControls } from "./sandbox-controls";

export const metadata: Metadata = {
  title: "Sandbox payment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The sandbox provider's "hosted checkout page" (development only).
 *
 * It stands in for Easypaisa's hosted page until the sandbox credentials in
 * spec §9 arrive. Choosing an outcome here drives the *real* pipeline —
 * signed callback, signature verification, transaction inquiry, atomic stock
 * decrement — so the lifecycle under test is the production one, with only the
 * provider swapped.
 *
 * `notFound()` in production is belt and braces: `env.ts` already refuses to
 * boot with PAYMENT_PROVIDER="fake" there.
 */
export default async function SandboxPaymentPage(
  props: PageProps<"/checkout/sandbox/[orderNumber]">,
) {
  if (serverEnv().NODE_ENV === "production") notFound();

  const user = await requireUser();
  const { orderNumber } = await props.params;
  const order = await getOrder(user.id, orderNumber);
  if (!order) notFound();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-4">
      <header className="rounded-lg border border-dashed border-amber-500/60 bg-amber-500/5 p-4">
        <h1 className="text-lg font-semibold">Sandbox payment</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Development stand-in for the Easypaisa hosted checkout. No money moves; the
          verification, inquiry and stock-decrement path is the real one.
        </p>
      </header>

      <dl className="flex flex-col gap-2 rounded-lg border border-[var(--color-line)] p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--color-muted)]">Order</dt>
          <dd>{order.orderNumber}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--color-muted)]">Amount</dt>
          <dd className="tabular-nums">
            {formatMoney(order.grandTotal, order.currency)}
          </dd>
        </div>
      </dl>

      <SandboxControls orderNumber={order.orderNumber} />
    </div>
  );
}
