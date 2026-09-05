"use client";

import { Button } from "@/components/admin/ui";
import { Td, Th } from "@/components/admin/table";

/**
 * The variant editor used by the create screen, where variants exist only as
 * form state until the product is saved. The edit screen has its own version
 * that talks to the variant endpoints directly, because there a variant is a
 * row that other things — cart lines, order items — already point at.
 *
 * Every field is a string here. Coercion belongs to Zod on the server, and
 * keeping the input untouched means an operator sees back exactly what they
 * typed when it fails to validate.
 */

export interface VariantDraft {
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  price: string;
  stock: string;
}

export const emptyVariant: VariantDraft = {
  size: "",
  colorName: "",
  colorHex: "#000000",
  sku: "",
  price: "",
  stock: "0",
};

export function variantPayload(draft: VariantDraft) {
  return {
    size: draft.size.trim(),
    colorName: draft.colorName.trim(),
    colorHex: draft.colorHex.trim().toLowerCase(),
    sku: draft.sku.trim().toUpperCase(),
    // Empty means "inherit the product's base price" (AD-5), which is null —
    // not zero, and not the empty string.
    price: draft.price.trim() === "" ? null : draft.price.trim(),
    stock: draft.stock.trim() === "" ? 0 : Number(draft.stock),
  };
}

export function VariantDraftTable({
  variants,
  onChange,
  disabled,
}: {
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
  disabled?: boolean;
}) {
  function patch(index: number, change: Partial<VariantDraft>) {
    onChange(
      variants.map((variant, position) =>
        position === index ? { ...variant, ...change } : variant,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Variants</h3>
        <p className="text-xs text-[var(--color-muted)]">
          Stock lives on the variant, so a product with none has nothing to sell.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr>
              <Th>Size</Th>
              <Th>Colour</Th>
              <Th>Hex</Th>
              <Th>SKU</Th>
              <Th align="right">Price</Th>
              <Th align="right">Stock</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant, index) => (
              <tr key={index}>
                <Td>
                  <CellInput
                    label={`Size for variant ${index + 1}`}
                    value={variant.size}
                    disabled={disabled}
                    onChange={(size) => patch(index, { size })}
                  />
                </Td>
                <Td>
                  <CellInput
                    label={`Colour name for variant ${index + 1}`}
                    value={variant.colorName}
                    disabled={disabled}
                    onChange={(colorName) => patch(index, { colorName })}
                  />
                </Td>
                <Td>
                  <input
                    type="color"
                    aria-label={`Colour swatch for variant ${index + 1}`}
                    value={variant.colorHex}
                    disabled={disabled}
                    onChange={(event) => patch(index, { colorHex: event.target.value })}
                    className="h-8 w-12 rounded border border-[var(--color-line)]"
                  />
                </Td>
                <Td>
                  <CellInput
                    label={`SKU for variant ${index + 1}`}
                    value={variant.sku}
                    disabled={disabled}
                    onChange={(sku) => patch(index, { sku })}
                  />
                </Td>
                <Td align="right">
                  <CellInput
                    label={`Price for variant ${index + 1}`}
                    value={variant.price}
                    placeholder="base"
                    inputMode="decimal"
                    disabled={disabled}
                    onChange={(price) => patch(index, { price })}
                  />
                </Td>
                <Td align="right">
                  <CellInput
                    label={`Stock for variant ${index + 1}`}
                    value={variant.stock}
                    inputMode="numeric"
                    disabled={disabled}
                    onChange={(stock) => patch(index, { stock })}
                  />
                </Td>
                <Td>
                  <Button
                    tone="danger"
                    disabled={disabled}
                    onClick={() =>
                      onChange(variants.filter((_, position) => position !== index))
                    }
                  >
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <Button
          disabled={disabled}
          onClick={() => onChange([...variants, { ...emptyVariant }])}
        >
          Add variant
        </Button>
      </div>
    </div>
  );
}

export function CellInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full min-w-[5rem] rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm ${
        inputMode ? "text-right tabular-nums" : ""
      }`}
    />
  );
}
