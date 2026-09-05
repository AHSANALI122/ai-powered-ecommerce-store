"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/admin/ui";
import { Badge, Td, Th } from "@/components/admin/table";
import {
  ProductFields,
  productPayload,
  type CategoryOption,
  type ProductFieldValues,
} from "@/components/admin/product-fields";
import { CellInput, emptyVariant, variantPayload } from "@/components/admin/variant-rows";
import type { AdminProductDetail, AdminVariantView } from "@/server/admin/products";

/**
 * The edit screen.
 *
 * Variants are saved one at a time against their own endpoints, unlike the
 * create screen's single transaction. That is the right shape here: an existing
 * variant is a row that cart lines and order items already reference, so
 * "replace the set" would delete and recreate identities that other tables
 * point at. Editing one row at a time also means a rejected SKU on the third
 * variant does not roll back the two before it.
 */
export function ProductEditor({
  product,
  categories,
  canDelete,
}: {
  product: AdminProductDetail;
  categories: CategoryOption[];
  canDelete: boolean;
}) {
  const router = useRouter();

  const [values, setValues] = useState<ProductFieldValues>({
    slug: product.slug,
    title: product.title,
    description: product.description,
    brand: product.brand ?? "",
    gender: product.gender,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice ?? "",
    categoryId: product.categoryId,
    images: product.images,
    isActive: product.isActive,
    isFeatured: product.isFeatured,
  });
  const [variants, setVariants] = useState<AdminVariantView[]>(product.variants);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await apiFetch<{ product: AdminProductDetail }>(
        `/api/admin/products/${product.id}`,
        { method: "PATCH", body: JSON.stringify(productPayload(values)) },
      );
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      setNotice("Saved. The storefront cache for this product was invalidated.");
      router.refresh();
    });
  }

  function removeProduct() {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/admin/products/${product.id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push("/admin/products");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={saveProduct} className="flex flex-col gap-6">
        <FormError>{error}</FormError>
        <FormNotice>{notice}</FormNotice>

        <ProductFields
          values={values}
          categories={categories}
          fieldErrors={fieldErrors}
          disabled={pending}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
        />

        <div>
          <SubmitButton pending={pending}>Save product</SubmitButton>
        </div>
      </form>

      <VariantManager
        productId={product.id}
        variants={variants}
        onVariantsChange={setVariants}
        onError={setError}
        onNotice={setNotice}
      />

      {canDelete ? (
        <section className="flex flex-col gap-2 rounded-lg border border-red-600/30 p-4">
          <h3 className="text-sm font-medium">Delete this product</h3>
          <p className="text-xs text-[var(--color-muted)]">
            Past orders keep their own copy of every item, so deleting cannot change what
            anyone was charged. Cart lines pointing at it are removed. This cannot be
            undone — hiding the product is usually what you want instead.
          </p>
          <div>
            <ConfirmButton
              label="Delete product"
              confirmLabel="Really delete — this cannot be undone"
              disabled={pending}
              onConfirm={removeProduct}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Live variant rows: each row saves itself. */
function VariantManager({
  productId,
  variants,
  onVariantsChange,
  onError,
  onNotice,
}: {
  productId: string;
  variants: AdminVariantView[];
  onVariantsChange: (variants: AdminVariantView[]) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({ ...emptyVariant });
  const [pending, startTransition] = useTransition();

  function addVariant() {
    onError(null);
    onNotice(null);
    startTransition(async () => {
      const result = await apiFetch<{ variant: AdminVariantView }>(
        `/api/admin/products/${productId}/variants`,
        { method: "POST", body: JSON.stringify(variantPayload(draft)) },
      );
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      onVariantsChange([...variants, result.data.variant]);
      setDraft({ ...emptyVariant });
      router.refresh();
    });
  }

  function saveVariant(variant: AdminVariantView) {
    onError(null);
    onNotice(null);
    startTransition(async () => {
      const result = await apiFetch<{ variant: AdminVariantView }>(
        `/api/admin/variants/${variant.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            size: variant.size,
            colorName: variant.colorName,
            colorHex: variant.colorHex,
            sku: variant.sku,
            price: variant.price,
            stock: variant.stock,
            isActive: variant.isActive,
          }),
        },
      );
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      onVariantsChange(
        variants.map((entry) => (entry.id === variant.id ? result.data.variant : entry)),
      );
      onNotice(`Variant ${result.data.variant.sku} saved.`);
      router.refresh();
    });
  }

  function removeVariant(id: string) {
    onError(null);
    startTransition(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/admin/variants/${id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      onVariantsChange(variants.filter((entry) => entry.id !== id));
      router.refresh();
    });
  }

  function patch(id: string, change: Partial<AdminVariantView>) {
    onVariantsChange(
      variants.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">Variants</h3>
        <p className="text-xs text-[var(--color-muted)]">
          Stock and price live here (AD-5). A blank price inherits the base price.
        </p>
      </div>

      {variants.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-sm"
        >
          This product has no variants, so nothing about it can be bought.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead>
            <tr>
              <Th>Size</Th>
              <Th>Colour</Th>
              <Th>Hex</Th>
              <Th>SKU</Th>
              <Th align="right">Price</Th>
              <Th align="right">Stock</Th>
              <Th>Live</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id}>
                <Td>
                  <CellInput
                    label={`Size for ${variant.sku}`}
                    value={variant.size}
                    disabled={pending}
                    onChange={(size) => patch(variant.id, { size })}
                  />
                </Td>
                <Td>
                  <CellInput
                    label={`Colour name for ${variant.sku}`}
                    value={variant.colorName}
                    disabled={pending}
                    onChange={(colorName) => patch(variant.id, { colorName })}
                  />
                </Td>
                <Td>
                  <input
                    type="color"
                    aria-label={`Colour swatch for ${variant.sku}`}
                    value={variant.colorHex}
                    disabled={pending}
                    onChange={(event) =>
                      patch(variant.id, { colorHex: event.target.value })
                    }
                    className="h-8 w-12 rounded border border-[var(--color-line)]"
                  />
                </Td>
                <Td>
                  <CellInput
                    label={`SKU for ${variant.sku}`}
                    value={variant.sku}
                    disabled={pending}
                    onChange={(sku) => patch(variant.id, { sku })}
                  />
                </Td>
                <Td align="right">
                  <CellInput
                    label={`Price for ${variant.sku}`}
                    value={variant.price ?? ""}
                    placeholder="base"
                    inputMode="decimal"
                    disabled={pending}
                    onChange={(price) =>
                      patch(variant.id, { price: price === "" ? null : price })
                    }
                  />
                </Td>
                <Td align="right">
                  <CellInput
                    label={`Stock for ${variant.sku}`}
                    value={String(variant.stock)}
                    inputMode="numeric"
                    disabled={pending}
                    onChange={(stock) => patch(variant.id, { stock: Number(stock) || 0 })}
                  />
                </Td>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`${variant.sku} is purchasable`}
                    checked={variant.isActive}
                    disabled={pending}
                    onChange={(event) =>
                      patch(variant.id, { isActive: event.target.checked })
                    }
                    className="size-4"
                  />
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Button
                      tone="primary"
                      disabled={pending}
                      onClick={() => saveVariant(variant)}
                    >
                      Save
                    </Button>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Confirm"
                      disabled={pending}
                      onConfirm={() => removeVariant(variant.id)}
                    />
                  </div>
                </Td>
              </tr>
            ))}

            <tr>
              <Td>
                <CellInput
                  label="Size for the new variant"
                  value={draft.size}
                  disabled={pending}
                  onChange={(size) => setDraft({ ...draft, size })}
                />
              </Td>
              <Td>
                <CellInput
                  label="Colour name for the new variant"
                  value={draft.colorName}
                  disabled={pending}
                  onChange={(colorName) => setDraft({ ...draft, colorName })}
                />
              </Td>
              <Td>
                <input
                  type="color"
                  aria-label="Colour swatch for the new variant"
                  value={draft.colorHex}
                  disabled={pending}
                  onChange={(event) =>
                    setDraft({ ...draft, colorHex: event.target.value })
                  }
                  className="h-8 w-12 rounded border border-[var(--color-line)]"
                />
              </Td>
              <Td>
                <CellInput
                  label="SKU for the new variant"
                  value={draft.sku}
                  disabled={pending}
                  onChange={(sku) => setDraft({ ...draft, sku })}
                />
              </Td>
              <Td align="right">
                <CellInput
                  label="Price for the new variant"
                  value={draft.price}
                  placeholder="base"
                  inputMode="decimal"
                  disabled={pending}
                  onChange={(price) => setDraft({ ...draft, price })}
                />
              </Td>
              <Td align="right">
                <CellInput
                  label="Stock for the new variant"
                  value={draft.stock}
                  inputMode="numeric"
                  disabled={pending}
                  onChange={(stock) => setDraft({ ...draft, stock })}
                />
              </Td>
              <Td>
                <Badge>new</Badge>
              </Td>
              <Td>
                <Button tone="primary" disabled={pending} onClick={addVariant}>
                  Add
                </Button>
              </Td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Two-step destructive action. A `window.confirm` would be simpler, but a
 * native modal dialog blocks the page and is a poor fit for an operator working
 * through a list — this keeps the confirmation inline and keyboard-reachable.
 */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button tone="danger" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Button
        tone="danger"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button disabled={disabled} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
