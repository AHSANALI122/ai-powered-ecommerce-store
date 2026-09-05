import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { getAdminOrder } from "@/server/admin/orders";
import { formatAddress } from "@/server/orders/snapshot";
import { TableScroll, Td, Th } from "@/components/admin/table";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { OrderActions } from "./order-actions";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

/**
 * Order detail.
 *
 * Every figure here is read from the order row, not recomputed. The totals were
 * fixed by the server at checkout (SEC-4) and the item lines are snapshots
 * (spec §5): re-deriving them from today's catalogue would show a number the
 * customer was never charged, which is worse than useless on the screen someone
 * opens to answer a billing question.
 */
export default async function AdminOrderPage(
  props: PageProps<"/admin/orders/[orderNumber]">,
) {
  await requireRole("STAFF", "ADMIN");
  const { orderNumber } = await props.params;

  const order = await getAdminOrder(orderNumber);
  if (!order) notFound();

  const address = order.shippingAddress;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Order {order.orderNumber}</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Placed {order.placedAt.toISOString().replace("T", " ").slice(0, 19)}
            {order.paidAt
              ? ` · paid ${order.paidAt.toISOString().replace("T", " ").slice(0, 19)}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
          <Link href="/admin/orders" className="text-sm underline underline-offset-4">
            Back to orders
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <section className="rounded-lg border border-[var(--color-line)] p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Customer
          </h3>
          <p className="mt-2 font-medium">{order.customerName ?? "Guest checkout"}</p>
          <p className="text-[var(--color-muted)]">{order.email}</p>
        </section>

        <section className="rounded-lg border border-[var(--color-line)] p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Ship to
          </h3>
          {address ? (
            <address className="mt-2 not-italic text-[var(--color-muted)]">
              {formatAddress(address).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : (
            <p className="mt-2 text-[var(--color-muted)]">
              The stored address snapshot could not be read.
            </p>
          )}
          {order.shippingMethod ? (
            <p className="mt-2 text-xs">Method: {order.shippingMethod}</p>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--color-line)] p-4 text-sm">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            Payment
          </h3>
          <dl className="mt-2 flex flex-col gap-1 text-[var(--color-muted)]">
            <div className="flex justify-between gap-4">
              <dt>Provider</dt>
              <dd>{order.provider ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Reference</dt>
              <dd className="truncate font-mono text-xs">{order.providerRef ?? "—"}</dd>
            </div>
            {order.refundRef ? (
              <div className="flex justify-between gap-4">
                <dt>Refund ref</dt>
                <dd className="truncate font-mono text-xs">{order.refundRef}</dd>
              </div>
            ) : null}
            {order.expiresAt && order.paymentStatus === "PENDING" ? (
              <div className="flex justify-between gap-4">
                <dt>Payable until</dt>
                <dd>{order.expiresAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <TableScroll>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>SKU</Th>
            <Th align="right">Unit</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Line</Th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.sku}>
              <Td>
                <div className="font-medium">{item.productTitle}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {item.size} · {item.colorName}
                  {item.variantId === null ? " · variant since deleted" : ""}
                </div>
              </Td>
              <Td>
                <code className="text-xs">{item.sku}</code>
              </Td>
              <Td align="right">{formatMoney(item.unitPrice, order.currency)}</Td>
              <Td align="right">{item.quantity}</Td>
              <Td align="right">{formatMoney(item.lineTotal, order.currency)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <Td> </Td>
            <Td> </Td>
            <Td> </Td>
            <Td align="right">Subtotal</Td>
            <Td align="right">{formatMoney(order.subtotal, order.currency)}</Td>
          </tr>
          <tr>
            <Td> </Td>
            <Td> </Td>
            <Td> </Td>
            <Td align="right">Shipping</Td>
            <Td align="right">{formatMoney(order.shippingTotal, order.currency)}</Td>
          </tr>
          <tr>
            <Td> </Td>
            <Td> </Td>
            <Td> </Td>
            <Td align="right">Tax</Td>
            <Td align="right">{formatMoney(order.taxTotal, order.currency)}</Td>
          </tr>
          <tr>
            <Td> </Td>
            <Td> </Td>
            <Td> </Td>
            <Td align="right">
              <strong>Total</strong>
            </Td>
            <Td align="right">
              <strong>{formatMoney(order.grandTotal, order.currency)}</strong>
            </Td>
          </tr>
        </tfoot>
      </TableScroll>

      <OrderActions
        orderNumber={order.orderNumber}
        status={order.status}
        paymentStatus={order.paymentStatus}
        allowedTransitions={[...order.allowedTransitions]}
      />
    </div>
  );
}
