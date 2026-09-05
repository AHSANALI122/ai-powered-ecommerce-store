"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/client/api";
import { FormError, SubmitButton } from "@/components/ui/form";
import {
  ProductFields,
  emptyProduct,
  productPayload,
  type CategoryOption,
  type ProductFieldValues,
} from "@/components/admin/product-fields";
import {
  VariantDraftTable,
  emptyVariant,
  variantPayload,
  type VariantDraft,
} from "@/components/admin/variant-rows";

/**
 * Creates the product and its variants in a single request.
 *
 * One request rather than "create the product, then loop over the variants":
 * the server writes both in one transaction, so a failure half way through
 * leaves nothing behind. The alternative would leave a live product with
 * nothing to buy — the exact state the F4 DoD says a new product must never be
 * in.
 */
export function NewProductForm({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFieldValues>({
    ...emptyProduct,
    categoryId: categories[0]?.id ?? "",
  });
  const [variants, setVariants] = useState<VariantDraft[]>([{ ...emptyVariant }]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await postJson<{ product: { id: string } }>("/api/admin/products", {
        ...productPayload(values),
        attributes: {},
        variants: variants
          // A blank trailing row is a UI convenience, not an empty variant.
          .filter((variant) => variant.sku.trim() !== "" || variant.size.trim() !== "")
          .map(variantPayload),
      });

      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }

      router.push(`/admin/products/${result.data.product.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <FormError>{error}</FormError>

      <ProductFields
        values={values}
        categories={categories}
        fieldErrors={fieldErrors}
        disabled={pending}
        onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
      />

      <VariantDraftTable variants={variants} onChange={setVariants} disabled={pending} />

      <div>
        <SubmitButton pending={pending}>Create product</SubmitButton>
      </div>
    </form>
  );
}
