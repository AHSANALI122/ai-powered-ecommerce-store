import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { LOW_STOCK_THRESHOLD, listInventory } from "@/server/admin/products";
import { InventoryTable } from "./inventory-table";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

/**
 * Inventory (F4).
 *
 * Rows are variants, ordered by stock ascending, so the shelves that need
 * attention are the ones on screen. The `threshold` filter defaults to showing
 * everything — an operator doing a stock-take needs the whole list, and the
 * low-stock view is one click away from the overview.
 */
export default async function AdminInventoryPage(props: PageProps<"/admin/inventory">) {
  await requireRole("STAFF", "ADMIN");

  const params = await props.searchParams;
  const threshold = readInt(params.threshold, 0, 1000);
  const page = readInt(params.page, 1, 500) ?? 1;
  const q =
    typeof params.q === "string" && params.q.trim() !== "" ? params.q.trim() : undefined;

  const rows = await listInventory({
    page,
    pageSize: 50,
    ...(threshold !== undefined ? { threshold } : {}),
    ...(q ? { q } : {}),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <p className="text-xs text-[var(--color-muted)]">
          Low-stock threshold: {LOW_STOCK_THRESHOLD} units
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-line)] p-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="SKU or product title"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Only at or below</span>
          <input
            type="number"
            name="threshold"
            min={0}
            max={1000}
            defaultValue={threshold ?? ""}
            placeholder="any"
            className="w-28 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
        >
          Apply
        </button>
      </form>

      <InventoryTable
        rows={rows.items}
        total={rows.total}
        page={rows.page}
        pageCount={rows.pageCount}
        lowStockThreshold={LOW_STOCK_THRESHOLD}
      />
    </div>
  );
}

function readInt(
  value: string | string[] | undefined,
  min: number,
  max: number,
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}
