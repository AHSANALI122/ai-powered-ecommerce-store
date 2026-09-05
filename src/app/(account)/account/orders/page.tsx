import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { listOrders } from "@/server/orders/queries";
import { runtimeRoute } from "@/lib/routes";
import { OrderStatusBadge } from "@/components/account/order-status-badge";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Order history (F3, SEC-23).
 *
 * `listOrders(user.id)` puts the owner in the `where` clause; nothing is
 * fetched and then filtered. The list is capped rather than paginated for now
 * — F4 brings the paginated, sort-whitelisted variant (SEC-24).
 */
export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await listOrders(user.id);

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
      </header>

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          You have not placed an order yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Link
                href={runtimeRoute(`/account/orders/${order.orderNumber}`)}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] p-4 text-sm hover:border-[var(--color-ink)]"
              >
                <span>
                  <span className="block font-medium">{order.orderNumber}</span>
                  <span className="block text-[var(--color-muted)]">
                    {order.placedAt.toISOString().slice(0, 10)} · {order.itemCount} item
                    {order.itemCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  <OrderStatusBadge
                    status={order.status}
                    paymentStatus={order.paymentStatus}
                  />
                  <span className="tabular-nums">
                    {formatMoney(order.grandTotal, order.currency)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
