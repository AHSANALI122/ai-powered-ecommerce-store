import { z } from "zod";
import { idSchema } from "@/lib/validation/cart";
import { adminListSchema } from "@/lib/validation/admin/list";

/**
 * Product, variant and category input for the admin dashboard (SEC-16, SEC-24).
 *
 * This is the *only* place in the application where a price arrives from a
 * client, so it is the only place where a price schema exists at all. SEC-4
 * says the server is the sole source of truth for what a shopper is charged;
 * it does not say prices appear from nowhere. The distinction is who is
 * speaking: a shopper never states a price (their schemas have no such field),
 * an operator whose STAFF/ADMIN role was re-read from the database does — and
 * even then the value is validated as a bounded 2-decimal string and stored as
 * `Decimal`, never parsed into a JS `number` on the way (AD-6).
 */

/**
 * A money amount as a decimal string. Accepting a string rather than a number
 * is the point: `12.10` and `0.1 + 0.2` are lossy the moment JSON parses them
 * into a float, and `toStorage()` downstream expects an exact value.
 */
export const priceSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "number" ? value.toString() : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Use a positive amount with up to 2 decimals."),
  );

export const optionalPriceSchema = z.union([priceSchema, z.null()]);

/**
 * A slug is the product's public URL and half of a cache-tag key, so the
 * character set is restricted rather than merely trimmed: a slug containing a
 * slash or `..` would change which route the row answers on.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");

/**
 * Image references are validated as paths or allowed-host URLs and are never
 * fetched (SEC-14). Nothing on the server dereferences one of these, which is
 * what stops the product form becoming an SSRF primitive: an operator can name
 * an image, not make the server issue a request.
 */
export const imageRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => {
    if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("..");
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return false;
      return (
        url.hostname === "images.pexels.com" ||
        url.hostname.endsWith(".public.blob.vercel-storage.com")
      );
    } catch {
      return false;
    }
  }, "Use an uploaded image path or an https URL on an allowed host.");

export const genderSchema = z.enum(["MEN", "WOMEN", "UNISEX"]);

/** Free-form product attributes, e.g. `{ fabric: "linen" }`. Strings only, bounded. */
export const attributesSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().max(200))
  .refine((value) => Object.keys(value).length <= 30, "Too many attributes.");

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const variantFields = {
  size: z.string().trim().min(1).max(16),
  colorName: z.string().trim().min(1).max(40),
  colorHex: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, "Use a #rrggbb colour."),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(64)
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "Use letters, digits, dot, dash or underscore."),
  /** null means "inherit Product.basePrice" (AD-5), which is not the same as 0. */
  price: optionalPriceSchema.optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  isActive: z.boolean().default(true),
  position: z.coerce.number().int().min(0).max(9999).default(0),
} as const;

export const variantCreateSchema = z.object(variantFields).strict();

export const variantUpdateSchema = z
  .object({
    ...variantFields,
    isActive: z.boolean(),
    position: z.coerce.number().int().min(0).max(9999),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

/**
 * The narrow endpoint the inventory screen posts to. It carries stock and
 * nothing else — an operator correcting a shelf count should not be able to
 * change a price by way of a form that happens to include one.
 */
export const stockUpdateSchema = z
  .object({
    updates: z
      .array(z.object({ variantId: idSchema, stock: variantFields.stock }).strict())
      .min(1)
      .max(100),
  })
  .strict();

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productFields = {
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(8000),
  brand: z.string().trim().max(80).nullable().optional(),
  gender: genderSchema,
  basePrice: priceSchema,
  compareAtPrice: optionalPriceSchema.optional(),
  images: z.array(imageRefSchema).max(12).default([]),
  attributes: attributesSchema.default({}),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  categoryId: idSchema,
} as const;

export const productCreateSchema = z
  .object({
    ...productFields,
    /**
     * Variants may be supplied inline. The F4 DoD is that a product an admin
     * creates is *immediately purchasable*, and a product with no variants has
     * nothing to buy — stock lives on the variant (AD-5).
     */
    variants: z.array(variantCreateSchema).max(60).default([]),
  })
  .strict();

export const productUpdateSchema = z
  .object({
    ...productFields,
    isActive: z.boolean(),
    isFeatured: z.boolean(),
    images: z.array(imageRefSchema).max(12),
    attributes: attributesSchema,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

export const productListSchema = adminListSchema([
  "createdAt",
  "updatedAt",
  "title",
  "basePrice",
] as const).extend({
  categoryId: idSchema.optional(),
  gender: genderSchema.optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  /** Drives the low-stock screen. Bounded, so it cannot become a full scan. */
  lowStock: z.coerce.number().int().min(0).max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryFields = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).nullable().optional(),
  image: imageRefSchema.nullable().optional(),
  position: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  /** The tree is two levels (spec §5); the service rejects a parent that has one. */
  parentId: idSchema.nullable().optional(),
} as const;

export const categoryCreateSchema = z.object(categoryFields).strict();

export const categoryUpdateSchema = z
  .object({
    ...categoryFields,
    position: z.coerce.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type ProductListQuery = z.infer<typeof productListSchema>;
export type VariantCreateInput = z.infer<typeof variantCreateSchema>;
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>;
export type StockUpdateInput = z.infer<typeof stockUpdateSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
