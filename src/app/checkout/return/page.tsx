import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { getOrder } from "@/server/orders/queries";
import { ReturnStatus } from "./return-status";

/** Never indexed (spec §7). */
export const metadata: Metadata = {
  title: "Payment status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Where the provider sends the browser back to (F3, §10 #33).
 *
 * This page reports what the **server** believes, and the server only believes
 * a verified webhook plus a transaction inquiry (AD-8, SEC-6). Landing here —
 * with any query string at all, forged or genuine — changes nothing. That is
 * why nothing on this page reads a `status` parameter: there is no success
 * redirect to spoof, because success is not read from the redirect.
 *
 * A payment is usually confirmed within seconds of the shopper returning, but
 * the callback is a separate network path and may arrive after them, so the
 * client polls the order's own status for a short while.
 */
export default async function CheckoutReturnPage(props: PageProps<"/checkout/return">) {
  const user = await requireUser();
  const { order: orderNumber } = await props.searchParams;

  const requested = typeof orderNumber === "string" ? orderNumber : null;
  // Owner-scoped: a guessed order number is a 404, not a peek (SEC-23).
  const order = requested ? await getOrder(user.id, requested) : null;

  if (!order) {
    return (
      <div className="flex flex-col items-start gap-4 py-4">
        <h1 className="text-2xl font-semibold tracking-tight">Order not found</h1>
        <p className="text-sm text-[var(--color-muted)]">
          We could not find that order on your account.
        </p>
        <Link href="/account/orders" className="text-sm underline underline-offset-4">
          Your orders
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Order {order.orderNumber}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Confirmation is taken from {order.paymentStatus === "PAID" ? "the" : "a"}{" "}
          verified message from the payment provider, never from this page&rsquo;s URL.
        </p>
      </header>

      <ReturnStatus
        orderNumber={order.orderNumber}
        initialStatus={order.status}
        initialPaymentStatus={order.paymentStatus}
      />

      <Link
        href={`/account/orders/${order.orderNumber}`}
        className="self-start text-sm underline underline-offset-4"
      >
        View order details
      </Link>
    </div>
  );
}
