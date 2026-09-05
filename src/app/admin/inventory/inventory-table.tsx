"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, FormNotice } from "@/components/ui/form";
import { Button } from "@/components/admin/ui";
import { Badge, EmptyState, Td, Th } from "@/components/admin/table";
import type { InventoryRow } from "@/server/admin/products";

/**
 * Editable stock counts, saved as one batch.
 *
 * The values sent are absolute, not deltas — see `updateStock` for why that is
 * the only shape that survives a capture decrementing the same row while this
 * screen is open. The consequence an operator should understand is visible in
 * the wording below: this sets the count, it does not add to it.
 */
export function InventoryTable({
  rows,
  total,
  page,
  pageCount,
  lowStockThreshold,
}: {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageCount: number;
  lowStockThreshold: number;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = rows.filter((row) => {
    const value = edits[row.variantId];
    return value !== undefined && value.trim() !== "" && Number(value) !== row.stock;
  });

  function save() {
    setError(null);
    setNotice(null);

    const updates = changed.map((row) => ({
      variantId: row.variantId,
      stock: Number(edits[row.variantId]),
    }));
    if (updates.some((update) => !Number.isInteger(update.stock) || update.stock < 0)) {
      setError("Stock must be a whole number of units, zero or more.");
      return;
    }

    startTransition(async () => {
      const result = await apiFetch<{ updated: number }>("/api/admin/inventory", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNotice(`Updated ${result.data.updated} variant(s).`);
      setEdits({});
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <EmptyState>No variants match this filter.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="px-3 py-2 text-left text-xs text-[var(--color-muted)]">
            {total.toLocaleString()} variant{total === 1 ? "" : "s"} · page {page} of{" "}
            {pageCount}. Entering a number sets the count; it does not add to it.
          </caption>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Variant</Th>
              <Th>SKU</Th>
              <Th align="right">In stock</Th>
              <Th align="right">Set to</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
                  <Badge
                    tone={
                      row.stock === 0
                        ? "bad"
                        : row.stock <= lowStockThreshold
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {row.stock}
                  </Badge>
                </Td>
                <Td align="right">
                  <input
                    aria-label={`New stock count for ${row.sku}`}
                    inputMode="numeric"
                    value={edits[row.variantId] ?? String(row.stock)}
                    disabled={pending}
                    onChange={(event) =>
                      setEdits({ ...edits, [row.variantId]: event.target.value })
                    }
                    className="w-24 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-right text-sm tabular-nums"
                  />
                </Td>
                <Td>
                  {!row.productActive ? (
                    <Badge>product hidden</Badge>
                  ) : row.isActive ? (
                    <Badge tone="good">live</Badge>
                  ) : (
                    <Badge>variant off</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button tone="primary" disabled={pending || changed.length === 0} onClick={save}>
          {changed.length === 0
            ? "No changes"
            : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
        </Button>
        {changed.length > 0 ? (
          <Button disabled={pending} onClick={() => setEdits({})}>
            Discard
          </Button>
        ) : null}
      </div>
    </div>
  );
}
