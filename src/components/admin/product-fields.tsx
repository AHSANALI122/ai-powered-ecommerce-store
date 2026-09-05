"use client";

import { TextField } from "@/components/ui/form";
import { CheckboxField, SelectField, TextAreaField } from "@/components/admin/ui";
import { ImageUploader } from "@/components/admin/image-uploader";

/**
 * The product field set, shared by the create and edit screens so the two
 * cannot drift into offering different fields for the same row.
 *
 * Prices are `type="text"` with an `inputMode`, not `type="number"`. A numeric
 * input hands back a value the browser has already coerced — and locale-formats
 * on some platforms — while the API takes a decimal *string* and the database
 * stores `Decimal` (AD-6). Keeping the character sequence the operator typed
 * intact all the way to Postgres is the whole point.
 */

export interface ProductFieldValues {
  slug: string;
  title: string;
  description: string;
  brand: string;
  gender: "MEN" | "WOMEN" | "UNISEX";
  basePrice: string;
  compareAtPrice: string;
  categoryId: string;
  images: string[];
  isActive: boolean;
  isFeatured: boolean;
}

export interface CategoryOption {
  id: string;
  label: string;
}

export function ProductFields({
  values,
  onChange,
  categories,
  fieldErrors,
  disabled,
}: {
  values: ProductFieldValues;
  onChange: (patch: Partial<ProductFieldValues>) => void;
  categories: CategoryOption[];
  fieldErrors: Record<string, string[]>;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          value={values.title}
          errors={fieldErrors.title}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value })}
        />
        <TextField
          label="Slug"
          value={values.slug}
          hint="Lowercase words separated by hyphens. This is the public URL."
          errors={fieldErrors.slug}
          disabled={disabled}
          onChange={(event) => onChange({ slug: event.target.value })}
        />
      </div>

      <TextAreaField
        label="Description"
        value={values.description}
        errors={fieldErrors.description}
        disabled={disabled}
        onChange={(event) => onChange({ description: event.target.value })}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Base price"
          value={values.basePrice}
          inputMode="decimal"
          hint="Used when a variant has no price of its own."
          errors={fieldErrors.basePrice}
          disabled={disabled}
          onChange={(event) => onChange({ basePrice: event.target.value })}
        />
        <TextField
          label="Compare-at price"
          value={values.compareAtPrice}
          inputMode="decimal"
          hint="Optional. Shown struck through."
          errors={fieldErrors.compareAtPrice}
          disabled={disabled}
          onChange={(event) => onChange({ compareAtPrice: event.target.value })}
        />
        <TextField
          label="Brand"
          value={values.brand}
          errors={fieldErrors.brand}
          disabled={disabled}
          onChange={(event) => onChange({ brand: event.target.value })}
        />
        <SelectField
          label="Gender"
          value={values.gender}
          errors={fieldErrors.gender}
          disabled={disabled}
          onChange={(event) =>
            onChange({ gender: event.target.value as ProductFieldValues["gender"] })
          }
        >
          <option value="MEN">Men</option>
          <option value="WOMEN">Women</option>
          <option value="UNISEX">Unisex</option>
        </SelectField>
      </div>

      <SelectField
        label="Category"
        value={values.categoryId}
        errors={fieldErrors.categoryId}
        disabled={disabled}
        onChange={(event) => onChange({ categoryId: event.target.value })}
      >
        <option value="">Choose a category…</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </SelectField>

      <ImageUploader
        images={values.images}
        disabled={disabled}
        onChange={(images) => onChange({ images })}
      />

      <div className="flex flex-wrap gap-6">
        <CheckboxField
          label="Visible in the catalogue"
          checked={values.isActive}
          disabled={disabled}
          onChange={(isActive) => onChange({ isActive })}
        />
        <CheckboxField
          label="Featured on the homepage"
          checked={values.isFeatured}
          disabled={disabled}
          onChange={(isFeatured) => onChange({ isFeatured })}
        />
      </div>
    </div>
  );
}

/**
 * Turns the form's strings into the JSON body the API expects: empty optional
 * fields become `null` rather than `""`, because "no compare-at price" and "a
 * compare-at price of nothing" are different claims and only one of them
 * validates.
 */
export function productPayload(values: ProductFieldValues) {
  return {
    slug: values.slug.trim(),
    title: values.title.trim(),
    description: values.description.trim(),
    brand: values.brand.trim() === "" ? null : values.brand.trim(),
    gender: values.gender,
    basePrice: values.basePrice.trim(),
    compareAtPrice:
      values.compareAtPrice.trim() === "" ? null : values.compareAtPrice.trim(),
    categoryId: values.categoryId,
    images: values.images,
    isActive: values.isActive,
    isFeatured: values.isFeatured,
  };
}

export const emptyProduct: ProductFieldValues = {
  slug: "",
  title: "",
  description: "",
  brand: "",
  gender: "UNISEX",
  basePrice: "",
  compareAtPrice: "",
  categoryId: "",
  images: [],
  isActive: true,
  isFeatured: false,
};
