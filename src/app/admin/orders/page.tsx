import type { Metadata } from "next";
import Link from "next/link";
import { runtimeRoute } from "@/lib/routes";
import { requireRole } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { orderListSchema } from "@/lib/validation/admin/operations";
import { listAdminOrders } from "@/server/admin/orders";
import { EmptyState, Pager, TableScroll, Td, Th } from "@/components/admin/table";
import { OrderStatusBadge } from "@/components/account/order-status-badge";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const STATUSES = [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
] as const;

/**
 * Order list — the store-wide view, gated on a database-checked STAFF/ADMIN
 * role rather than scoped to an owner. Paginated with a capped page size, so
 * "list every order" is not one request away (SEC-24).
 */
export default async function AdminOrdersPage(props: PageProps<"/admin/orders">) {
  await requireRole("STAFF", "ADMIN");

  const params = await props.searchParams;
  const parsed = orderListSchema.safeParse(flatten(params));
  const query = parsed.success ? parsed.data : orderListSchema.parse({});

  const page = await listAdminOrders(query);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">Orders</h2>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-line)] p-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Order number or email"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={query.status ?? ""}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Payment</span>
          <select
            name="paymentStatus"
            defaultValue={query.paymentStatus ?? ""}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            <option value="PENDING">pending</option>
            <option value="PAID">paid</option>
            <option value="FAILED">failed</option>
            <option value="REFUNDED">refunded</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
        >
          Apply
        </button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState>No orders match this filter.</EmptyState>
      ) : (
        <>
          <TableScroll>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Placed</Th>
                <Th>Customer</Th>
                <Th align="right">Items</Th>
                <Th>Status</Th>
                <Th>Provider</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((order) => (
                <tr key={order.orderNumber}>
                  <Td>
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {order.orderNumber}
                    </Link>
                  </Td>
                  <Td>{order.placedAt.toISOString().slice(0, 16).replace("T", " ")}</Td>
                  <Td>
                    <div>{order.customerName ?? "Guest"}</div>
                    <div className="text-xs text-[var(--color-muted)]">{order.email}</div>
                  </Td>
                  <Td align="right">{order.itemCount}</Td>
                  <Td>
                    <OrderStatusBadge
                      status={order.status}
                      paymentStatus={order.paymentStatus}
                    />
                  </Td>
                  <Td>
                    <span className="text-xs uppercase text-[var(--color-muted)]">
                      {order.provider ?? "—"}
                    </span>
                  </Td>
                  <Td align="right">{formatMoney(order.grandTotal, order.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>

          <Pager
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            buildHref={(next) =>
              runtimeRoute(`/admin/orders${buildSearch(params, next)}`)
            }
          />
        </>
      )}
    </div>
  );
}

function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") out[key] = first;
  }
  return out;
}

function buildSearch(
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams(flatten(params));
  search.set("page", String(page));
  return `?${search.toString()}`;
}
