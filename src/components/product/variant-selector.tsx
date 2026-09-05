"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import type { ProductVariantView } from "@/server/catalog/queries";

/**
 * Size + colour selection (F2, AD-5).
 *
 * Three rules the rest of the app depends on:
 *
 *  1. **Price and stock come from the selected variant**, never from the
 *     product. `price` here is already `variant.price ?? product.basePrice`,
 *     resolved on the server.
 *  2. **Unavailable combinations are disabled, not hidden.** Removing a size
 *     that exists but is sold out tells the shopper it was never made; showing
 *     it greyed out tells them the truth, and is what a size-availability
 *     conversation with a customer actually needs.
 *  3. **The displayed price is a display.** Nothing here is trusted at
 *     checkout — the server recomputes every amount from the database (SEC-4).
 *
 * The selection is mirrored into `?size=&color=` so a specific variant can be
 * linked and shared. That is a `replace`, not a `push`: browsing colours should
 * not fill the back button with history entries.
 */
export function VariantSelector({
  variants,
  currency,
  lowStockThreshold = 5,
}: {
  variants: ProductVariantView[];
  currency: string;
  lowStockThreshold?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const colors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const variant of variants) {
      if (!seen.has(variant.colorName)) seen.set(variant.colorName, variant.colorHex);
    }
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [variants]);

  const sizes = useMemo(
    () => [...new Set(variants.map((variant) => variant.size))],
    [variants],
  );

  const firstAvailable = variants.find((variant) => variant.stock > 0) ?? variants[0];

  const urlColor = searchParams.get("color");
  const urlSize = searchParams.get("size");

  const [color, setColor] = useState<string>(
    () =>
      (urlColor && colors.some((entry) => entry.name === urlColor) ? urlColor : null) ??
      firstAvailable?.colorName ??
      "",
  );
  const [size, setSize] = useState<string>(
    () =>
      (urlSize && sizes.includes(urlSize) ? urlSize : null) ?? firstAvailable?.size ?? "",
  );

  const selected = variants.find(
    (variant) => variant.colorName === color && variant.size === size,
  );

  function sync(nextColor: string, nextSize: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("color", nextColor);
    params.set("size", nextSize);
    router.replace(runtimeRoute(`${pathname}?${params.toString()}`), { scroll: false });
  }

  function chooseColor(next: string) {
    setColor(next);
    // Keep the size if that combination exists; otherwise move to the first
    // size this colour is actually made in.
    const keepsSize = variants.some(
      (variant) => variant.colorName === next && variant.size === size,
    );
    const nextSize = keepsSize
      ? size
      : (variants.find((variant) => variant.colorName === next && variant.stock > 0)
          ?.size ??
        variants.find((variant) => variant.colorName === next)?.size ??
        size);
    setSize(nextSize);
    sync(next, nextSize);
  }

  function chooseSize(next: string) {
    setSize(next);
    sync(color, next);
  }

  const availability = (() => {
    if (!selected) return { label: "Not available in this combination", tone: "muted" };
    if (selected.stock <= 0) return { label: "Sold out", tone: "muted" };
    if (selected.stock <= lowStockThreshold)
      return { label: `Only ${selected.stock} left`, tone: "warn" };
    return { label: "In stock", tone: "ok" };
  })();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-2xl font-semibold tabular-nums" aria-live="polite">
        {selected ? formatMoney(selected.price, currency) : "—"}
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">
          Colour: <span className="font-normal">{color}</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {colors.map((entry) => {
            const anyInStock = variants.some(
              (variant) => variant.colorName === entry.name && variant.stock > 0,
            );
            return (
              <button
                key={entry.name}
                type="button"
                onClick={() => chooseColor(entry.name)}
                aria-pressed={entry.name === color}
                title={anyInStock ? entry.name : `${entry.name} — sold out`}
                className="flex items-center gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs aria-pressed:border-[var(--color-ink)] aria-pressed:ring-1 aria-pressed:ring-[var(--color-ink)]"
              >
                <span
                  aria-hidden="true"
                  className="size-4 rounded-full border border-black/10"
                  style={{ backgroundColor: entry.hex }}
                />
                <span className={anyInStock ? "" : "line-through opacity-60"}>
                  {entry.name}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Size</legend>
        <div className="flex flex-wrap gap-2">
          {sizes.map((option) => {
            const variant = variants.find(
              (entry) => entry.colorName === color && entry.size === option,
            );
            const unavailable = !variant || variant.stock <= 0;
            return (
              <button
                key={option}
                type="button"
                onClick={() => chooseSize(option)}
                disabled={unavailable}
                aria-pressed={option === size}
                title={
                  !variant
                    ? `Not made in ${color}`
                    : variant.stock <= 0
                      ? "Sold out"
                      : undefined
                }
                className="min-w-12 rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm aria-pressed:border-[var(--color-ink)] aria-pressed:bg-[var(--color-ink)] aria-pressed:text-[var(--color-surface)] disabled:cursor-not-allowed disabled:line-through disabled:opacity-40"
              >
                {option}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p
        className={
          availability.tone === "warn"
            ? "text-sm text-amber-700 dark:text-amber-500"
            : "text-sm text-[var(--color-muted)]"
        }
        aria-live="polite"
      >
        {availability.label}
        {selected ? (
          <span className="ml-2 text-xs text-[var(--color-muted)]">
            SKU {selected.sku}
          </span>
        ) : null}
      </p>

      <button
        type="button"
        disabled
        className="rounded-md bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-[var(--color-surface)] disabled:opacity-50"
        title="The cart arrives with F3"
      >
        Add to cart
      </button>
      <p className="text-xs text-[var(--color-muted)]">
        The cart and checkout land in F3. Availability shown here is re-checked
        server-side before any payment is taken.
      </p>
    </div>
  );
}
