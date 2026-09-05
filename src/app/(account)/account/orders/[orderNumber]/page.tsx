import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import { getOrder } from "@/server/orders/queries";
import { formatAddress } from "@/server/orders/snapshot";
import { OrderStatusBadge } from "@/components/account/order-status-badge";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A single order (F3, SEC-23).
 *
 * Everything shown is a **snapshot** taken when the order was placed: the
 * product titles, sizes, colours, unit prices and delivery address are stored
 * on the order rows, not joined from the catalogue. A price change or a
 * renamed product tomorrow does not rewrite what was bought today (spec §5).
 *
 * `getOrder` filters on `{ orderNumber, userId }`, so another customer's order
 * number is a 404 here.
 */
export default async function OrderDetailPage(
  props: PageProps<"/account/orders/[orderNumber]">,
) {
  const user = await requireUser();
  const { orderNumber } = await props.params;
  const order = await getOrder(user.id, orderNumber);
  if (!order) notFound();

  const address = order.shippingAddress;

  return (
    <div className="flex flex-col gap-8 py-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Placed {order.placedAt.toISOString().slice(0, 10)}
            {order.paidAt ? ` · paid ${order.paidAt.toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
      </header>

      {order.paymentStatus === "PENDING" ? (
        <p className="rounded-lg border border-[var(--color-line)] p-4 text-sm text-[var(--color-muted)]">
          This order is waiting on a confirmed payment. Nothing has been charged and no
          stock is held; if the payment is not confirmed it will be cancelled
          automatically.
        </p>
      ) : null}

      {order.paymentStatus === "REFUNDED" ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          This order was paid but could not be fulfilled — an item sold out before it
          could be allocated — so the payment was reversed.
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Items</h2>
        <ul className="flex flex-col gap-3">
          {order.items.map((item) => (
            <li
              key={item.sku}
              className="flex gap-4 rounded-lg border border-[var(--color-line)] p-4"
            >
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md bg-black/[0.03]">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={runtimeRoute(`/p/${item.productSlug}`)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.productTitle}
                  </Link>
                  <p className="text-sm text-[var(--color-muted)]">
                    {item.colorName} · {item.size} · SKU {item.sku}
                  </p>
                  <p className="text-sm text-[var(--color-muted)] tabular-nums">
                    {formatMoney(item.unitPrice, order.currency)} × {item.quantity}
                  </p>
                </div>
                <p className="tabular-nums">
                  {formatMoney(item.lineTotal, order.currency)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Delivery</h2>
          {address ? (
            <address className="text-sm not-italic text-[var(--color-muted)]">
              {formatAddress(address).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              Address unavailable for this order.
            </p>
          )}
          {order.shippingMethod ? (
            <p className="text-sm text-[var(--color-muted)]">{order.shippingMethod}</p>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Totals</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <Row label="Subtotal" value={order.subtotal} currency={order.currency} />
            <Row label="Shipping" value={order.shippingTotal} currency={order.currency} />
            <Row label="Tax" value={order.taxTotal} currency={order.currency} />
            {Number(order.discountTotal) > 0 ? (
              <Row
                label="Discount"
                value={order.discountTotal}
                currency={order.currency}
              />
            ) : null}
            <div className="flex justify-between border-t border-[var(--color-line)] pt-2 font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums">
                {formatMoney(order.grandTotal, order.currency)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <Link href="/account/orders" className="text-sm underline underline-offset-4">
        Back to your orders
      </Link>
    </div>
  );
}

function Row({
  label,
  value,
  currency,
}: {
  label: string;
  value: string;
  currency: string;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="tabular-nums">{formatMoney(value, currency)}</dd>
    </div>
  );
}
