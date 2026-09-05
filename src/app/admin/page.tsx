import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { serverEnv } from "@/lib/env";
import { getAdminOverview, listAdminOrders } from "@/server/admin/orders";
import { LOW_STOCK_THRESHOLD, listInventory } from "@/server/admin/products";
import { listShippingZones } from "@/server/admin/shipping";
import { Badge, TableScroll, Td, Th } from "@/components/admin/table";
import { OrderStatusBadge } from "@/components/account/order-status-badge";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * The dashboard landing screen.
 *
 * It answers the three questions an operator opens the tool to ask — what came
 * in, what is running out, what is waiting on me — and then two the store's own
 * configuration can get wrong silently:
 *
 *  - **Demo data still present.** SEC-27 makes purging `source = "pexels"` rows
 *    a launch gate. A gate nobody can see is a gate nobody closes, so the count
 *    is on the first screen rather than in a runbook.
 *  - **No catch-all shipping zone.** Without one, a shopper in an unlisted
 *    country reaches checkout and finds no rate to pick. That failure is
 *    invisible from the inside — every test order ships to a country that
 *    happens to be listed.
 */
export default async function AdminOverviewPage() {
  await requireRole("STAFF", "ADMIN");

  const currency = serverEnv().BASE_CURRENCY;
  const [overview, recentOrders, lowStock, shipping] = await Promise.all([
    getAdminOverview(LOW_STOCK_THRESHOLD),
    listAdminOrders({ page: 1, pageSize: 8, sort: "placedAt", dir: "desc" }),
    listInventory({ page: 1, pageSize: 8, threshold: LOW_STOCK_THRESHOLD }),
    listShippingZones(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="counters">
        <h2 id="counters" className="sr-only">
          At a glance
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Orders today" value={overview.ordersToday} />
          <Stat
            label="Awaiting payment"
            value={overview.ordersPending}
            hint="PENDING orders expire on their own"
          />
          <Stat
            label="To fulfil"
            value={overview.ordersProcessing}
            href="/admin/orders?status=PROCESSING"
          />
          <Stat
            label="Reviews to moderate"
            value={overview.reviewsPending}
            href="/admin/reviews?status=PENDING"
            tone={overview.reviewsPending > 0 ? "warn" : "neutral"}
          />
          <Stat
            label="Active products"
            value={overview.productsActive}
            href="/admin/products"
          />
          <Stat label="Hidden products" value={overview.productsInactive} />
          <Stat
            label={`Variants at or below ${LOW_STOCK_THRESHOLD}`}
            value={overview.lowStockVariants}
            href="/admin/inventory"
            tone={overview.lowStockVariants > 0 ? "warn" : "neutral"}
          />
          <Stat
            label="Demo products (purge before launch)"
            value={overview.seedProducts}
            tone={overview.seedProducts > 0 ? "bad" : "good"}
            hint="SEC-27"
          />
        </dl>
      </section>

      {!shipping.hasActiveCatchAll ? (
        <p
          role="status"
          className="rounded-md border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-sm"
        >
          No active catch-all shipping zone. Shoppers in countries no zone lists cannot
          check out.{" "}
          <Link href="/admin/shipping" className="underline underline-offset-4">
            Add a zone with countries <code>*</code>
          </Link>
          .
        </p>
      ) : null}

      <section aria-labelledby="recent-orders" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-orders" className="text-lg font-semibold">
            Recent orders
          </h2>
          <Link href="/admin/orders" className="text-sm underline underline-offset-4">
            All orders
          </Link>
        </div>
        {recentOrders.items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No orders yet.</p>
        ) : (
          <TableScroll>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Placed</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.items.map((order) => (
                <tr key={order.orderNumber}>
                  <Td>
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="underline underline-offset-4"
                    >
                      {order.orderNumber}
                    </Link>
                  </Td>
                  <Td>{order.placedAt.toISOString().slice(0, 10)}</Td>
                  <Td>{order.customerName ?? order.email}</Td>
                  <Td>
                    <OrderStatusBadge
                      status={order.status}
                      paymentStatus={order.paymentStatus}
                    />
                  </Td>
                  <Td align="right">{formatMoney(order.grandTotal, order.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section aria-labelledby="low-stock" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="low-stock" className="text-lg font-semibold">
            Running low
          </h2>
          <Link href="/admin/inventory" className="text-sm underline underline-offset-4">
            Manage inventory
          </Link>
        </div>
        {lowStock.items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nothing at or below {LOW_STOCK_THRESHOLD} units.
          </p>
        ) : (
          <TableScroll>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Variant</Th>
                <Th>SKU</Th>
                <Th align="right">Stock</Th>
              </tr>
            </thead>
            <tbody>
              {lowStock.items.map((row) => (
                <tr key={row.variantId}>
                  <Td>
                    <Link
                      href={`/admin/products/${row.productId}`}
                      className="underline underline-offset-4"
                    >
                      {row.productTitle}
                    </Link>
                  </Td>
                  <Td>
                    {row.size} · {row.colorName}
                  </Td>
                  <Td>
                    <code className="text-xs">{row.sku}</code>
                  </Td>
                  <Td align="right">
                    <Badge tone={row.stock === 0 ? "bad" : "warn"}>{row.stock}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <p className="text-xs text-[var(--color-muted)]">
        Prices shown in {currency}. Totals on orders are the amounts the server computed
        at checkout, not recomputed here.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  href?: Route;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "",
    good: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    bad: "text-red-700 dark:text-red-400",
  }[tone];

  const body = (
    <div className="rounded-lg border border-[var(--color-line)] p-4">
      <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </dd>
      {hint ? <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block">
      {body}
    </Link>
  );
}
