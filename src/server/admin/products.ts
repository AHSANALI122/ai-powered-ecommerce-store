import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Gender } from "@/generated/prisma/enums";
import { toStorage } from "@/lib/money";
import { paged, paginate, type Paged } from "@/lib/validation/admin/list";
import type {
  ProductCreateInput,
  ProductListQuery,
  ProductUpdateInput,
  StockUpdateInput,
  VariantCreateInput,
  VariantUpdateInput,
} from "@/lib/validation/admin/catalog";
import { revalidateCatalog } from "@/server/admin/revalidate";

/**
 * Product and variant administration (F4).
 *
 * Three things this module is careful about:
 *
 *  - **Stock is never written here except through the stock paths.** AD-5 puts
 *    stock on the variant, and `captureOrder` owns the decrement. An admin edit
 *    sets an absolute count, which is the only safe shape: a delta applied on
 *    top of a concurrent capture would double-count.
 *  - **Prices are strings all the way to Prisma.** `toStorage()` fixes the
 *    scale and Prisma writes a `Decimal`; nothing is ever a JS `number` (AD-6).
 *  - **Uniqueness is enforced by the database, not by a prior read.** A
 *    check-then-insert on `slug` or `sku` is a race under concurrent admins, so
 *    the writes catch Prisma's P2002 instead.
 */

export const LOW_STOCK_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface AdminVariantView {
  id: string;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  /** null means "inherits basePrice"; the UI must show that, not a zero. */
  price: string | null;
  stock: number;
  isActive: boolean;
  position: number;
}

export interface AdminProductRow {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  gender: Gender;
  basePrice: string;
  isActive: boolean;
  isFeatured: boolean;
  categoryId: string;
  categoryName: string;
  image: string | null;
  variantCount: number;
  totalStock: number;
  /** True when any active variant is at or below the low-stock threshold. */
  lowStock: boolean;
  source: string | null;
  updatedAt: Date;
}

export interface AdminProductDetail extends AdminProductRow {
  description: string;
  compareAtPrice: string | null;
  images: string[];
  attributes: Record<string, string>;
  ratingAvg: string;
  ratingCount: number;
  variants: AdminVariantView[];
  createdAt: Date;
}

export type WriteResult<T> =
  { ok: true; value: T } | { ok: false; reason: WriteFailure; message: string };

export type WriteFailure =
  | "NOT_FOUND"
  | "SLUG_TAKEN"
  | "SKU_TAKEN"
  | "VARIANT_EXISTS"
  | "CATEGORY_NOT_FOUND"
  | "INVALID";

const VARIANT_SELECT = {
  id: true,
  size: true,
  colorName: true,
  colorHex: true,
  sku: true,
  price: true,
  stock: true,
  isActive: true,
  position: true,
} as const;

type VariantRow = {
  id: string;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  price: Prisma.Decimal | null;
  stock: number;
  isActive: boolean;
  position: number;
};

function toVariantView(row: VariantRow): AdminVariantView {
  return {
    id: row.id,
    size: row.size,
    colorName: row.colorName,
    colorHex: row.colorHex,
    sku: row.sku,
    price: row.price === null ? null : toStorage(row.price.toString()),
    stock: row.stock,
    isActive: row.isActive,
    position: row.position,
  };
}

/** Attributes are a free-form Json column; coerce to the string map the UI edits. */
function readAttributes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
    else if (typeof entry === "number" || typeof entry === "boolean") {
      out[key] = String(entry);
    }
  }
  return out;
}

function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  if (!field) return true;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((entry) => entry.includes(field));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const ORDER_BY: Record<
  ProductListQuery["sort"],
  (dir: "asc" | "desc") => Prisma.ProductOrderByWithRelationInput
> = {
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
  title: (dir) => ({ title: dir }),
  basePrice: (dir) => ({ basePrice: dir }),
};

/**
 * Admin listing. Unlike the storefront it shows inactive rows — that is the
 * point of the screen — but it is paginated and its `orderBy` comes from the
 * table above, never from the query string (SEC-24).
 */
export async function listAdminProducts(
  query: ProductListQuery,
): Promise<Paged<AdminProductRow>> {
  const where: Prisma.ProductWhereInput = {
    ...(query.status === "active" ? { isActive: true } : {}),
    ...(query.status === "inactive" ? { isActive: false } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.gender ? { gender: query.gender } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" as const } },
            { slug: { contains: query.q, mode: "insensitive" as const } },
            { brand: { contains: query.q, mode: "insensitive" as const } },
            { variants: { some: { sku: { contains: query.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
    ...(query.lowStock !== undefined
      ? { variants: { some: { isActive: true, stock: { lte: query.lowStock } } } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: ORDER_BY[query.sort](query.dir),
      ...paginate(query),
      select: {
        id: true,
        slug: true,
        title: true,
        brand: true,
        gender: true,
        basePrice: true,
        images: true,
        isActive: true,
        isFeatured: true,
        categoryId: true,
        source: true,
        updatedAt: true,
        category: { select: { name: true } },
        variants: { select: { stock: true, isActive: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    basePrice: toStorage(row.basePrice.toString()),
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    image: row.images[0] ?? null,
    variantCount: row.variants.length,
    totalStock: row.variants.reduce((total, variant) => total + variant.stock, 0),
    lowStock: row.variants.some(
      (variant) => variant.isActive && variant.stock <= LOW_STOCK_THRESHOLD,
    ),
    source: row.source,
    updatedAt: row.updatedAt,
  }));

  return paged(items, total, query);
}

export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const row = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      brand: true,
      gender: true,
      basePrice: true,
      compareAtPrice: true,
      images: true,
      attributes: true,
      ratingAvg: true,
      ratingCount: true,
      isActive: true,
      isFeatured: true,
      categoryId: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      variants: {
        orderBy: [{ position: "asc" }, { size: "asc" }],
        select: VARIANT_SELECT,
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    brand: row.brand,
    gender: row.gender,
    basePrice: toStorage(row.basePrice.toString()),
    compareAtPrice:
      row.compareAtPrice === null ? null : toStorage(row.compareAtPrice.toString()),
    images: row.images,
    attributes: readAttributes(row.attributes),
    ratingAvg: toStorage(row.ratingAvg.toString()),
    ratingCount: row.ratingCount,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    image: row.images[0] ?? null,
    variantCount: row.variants.length,
    totalStock: row.variants.reduce((total, variant) => total + variant.stock, 0),
    lowStock: row.variants.some(
      (variant) => variant.isActive && variant.stock <= LOW_STOCK_THRESHOLD,
    ),
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    variants: row.variants.map(toVariantView),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function variantCreateData(input: VariantCreateInput) {
  return {
    size: input.size,
    colorName: input.colorName,
    colorHex: input.colorHex,
    sku: input.sku,
    price: input.price == null ? null : toStorage(input.price),
    stock: input.stock,
    isActive: input.isActive,
    position: input.position,
  };
}

/**
 * Creates a product and, optionally, its variants in one transaction.
 *
 * All-or-nothing matters here: a product row that committed while its variants
 * failed is a live catalogue entry with nothing to buy, and the F4 DoD is that
 * a newly created product is immediately purchasable.
 */
export async function createProduct(
  input: ProductCreateInput,
): Promise<WriteResult<AdminProductDetail>> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true },
  });
  if (!category) {
    return {
      ok: false,
      reason: "CATEGORY_NOT_FOUND",
      message: "That category no longer exists.",
    };
  }

  const duplicateKey = firstDuplicateVariantKey(input.variants);
  if (duplicateKey) {
    return {
      ok: false,
      reason: "VARIANT_EXISTS",
      message: `Two variants share size ${duplicateKey}.`,
    };
  }

  try {
    const created = await prisma.product.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        brand: input.brand ?? null,
        gender: input.gender,
        basePrice: toStorage(input.basePrice),
        compareAtPrice:
          input.compareAtPrice == null ? null : toStorage(input.compareAtPrice),
        images: input.images,
        attributes: input.attributes as Prisma.InputJsonValue,
        isActive: input.isActive,
        isFeatured: input.isFeatured,
        categoryId: input.categoryId,
        variants: { create: input.variants.map(variantCreateData) },
      },
      select: { id: true, slug: true },
    });

    revalidateCatalog([created.slug]);
    const detail = await getAdminProduct(created.id);
    return detail
      ? { ok: true, value: detail }
      : { ok: false, reason: "NOT_FOUND", message: "Product not found." };
  } catch (error) {
    if (isUniqueViolation(error, "sku")) {
      return { ok: false, reason: "SKU_TAKEN", message: "That SKU is already in use." };
    }
    if (isUniqueViolation(error, "slug")) {
      return { ok: false, reason: "SLUG_TAKEN", message: "That slug is already in use." };
    }
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "VARIANT_EXISTS",
        message: "A variant with that size and colour already exists.",
      };
    }
    throw error;
  }
}

function firstDuplicateVariantKey(
  variants: readonly VariantCreateInput[],
): string | null {
  const seen = new Set<string>();
  for (const variant of variants) {
    const key = `${variant.size}/${variant.colorName}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export async function updateProduct(
  id: string,
  input: ProductUpdateInput,
): Promise<WriteResult<AdminProductDetail>> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { id: true, slug: true },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND", message: "Product not found." };

  if (input.categoryId !== undefined) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) {
      return {
        ok: false,
        reason: "CATEGORY_NOT_FOUND",
        message: "That category no longer exists.",
      };
    }
  }

  try {
    await prisma.product.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.brand !== undefined ? { brand: input.brand ?? null } : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.basePrice !== undefined
          ? { basePrice: toStorage(input.basePrice) }
          : {}),
        ...(input.compareAtPrice !== undefined
          ? {
              compareAtPrice:
                input.compareAtPrice == null ? null : toStorage(input.compareAtPrice),
            }
          : {}),
        ...(input.images !== undefined ? { images: input.images } : {}),
        ...(input.attributes !== undefined
          ? { attributes: input.attributes as Prisma.InputJsonValue }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error, "slug")) {
      return { ok: false, reason: "SLUG_TAKEN", message: "That slug is already in use." };
    }
    throw error;
  }

  // Both slugs: the old tag still guards the page prerendered at the old URL.
  revalidateCatalog([existing.slug, input.slug]);

  const detail = await getAdminProduct(id);
  return detail
    ? { ok: true, value: detail }
    : { ok: false, reason: "NOT_FOUND", message: "Product not found." };
}

/**
 * Hard delete. Safe for order history: `OrderItem` snapshots the title, SKU,
 * colour and unit price, and its `variantId` is `SetNull` on delete (spec §5),
 * so a removed product cannot rewrite what someone was charged. Cart lines
 * referencing it cascade away, which is the correct outcome — the item is gone.
 */
export async function deleteProduct(id: string): Promise<WriteResult<{ slug: string }>> {
  const existing = await prisma.product.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND", message: "Product not found." };

  await prisma.product.delete({ where: { id } });
  revalidateCatalog([existing.slug]);
  return { ok: true, value: { slug: existing.slug } };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function createVariant(
  productId: string,
  input: VariantCreateInput,
): Promise<WriteResult<AdminVariantView>> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });
  if (!product) return { ok: false, reason: "NOT_FOUND", message: "Product not found." };

  try {
    const variant = await prisma.productVariant.create({
      data: { productId, ...variantCreateData(input) },
      select: VARIANT_SELECT,
    });
    revalidateCatalog([product.slug]);
    return { ok: true, value: toVariantView(variant) };
  } catch (error) {
    if (isUniqueViolation(error, "sku")) {
      return { ok: false, reason: "SKU_TAKEN", message: "That SKU is already in use." };
    }
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "VARIANT_EXISTS",
        message: "This product already has that size and colour.",
      };
    }
    throw error;
  }
}

export async function updateVariant(
  variantId: string,
  input: VariantUpdateInput,
): Promise<WriteResult<AdminVariantView>> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, product: { select: { slug: true } } },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND", message: "Variant not found." };

  try {
    const variant = await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.colorName !== undefined ? { colorName: input.colorName } : {}),
        ...(input.colorHex !== undefined ? { colorHex: input.colorHex } : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.price !== undefined
          ? { price: input.price == null ? null : toStorage(input.price) }
          : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
      select: VARIANT_SELECT,
    });
    revalidateCatalog([existing.product.slug]);
    return { ok: true, value: toVariantView(variant) };
  } catch (error) {
    if (isUniqueViolation(error, "sku")) {
      return { ok: false, reason: "SKU_TAKEN", message: "That SKU is already in use." };
    }
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        reason: "VARIANT_EXISTS",
        message: "This product already has that size and colour.",
      };
    }
    throw error;
  }
}

export async function deleteVariant(
  variantId: string,
): Promise<WriteResult<{ sku: string }>> {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { sku: true, product: { select: { slug: true } } },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND", message: "Variant not found." };

  await prisma.productVariant.delete({ where: { id: variantId } });
  revalidateCatalog([existing.product.slug]);
  return { ok: true, value: { sku: existing.sku } };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export interface InventoryRow {
  variantId: string;
  sku: string;
  size: string;
  colorName: string;
  stock: number;
  isActive: boolean;
  productId: string;
  productTitle: string;
  productSlug: string;
  productActive: boolean;
}

/**
 * The inventory screen: variants, not products, because that is where stock
 * lives (AD-5). Ordered by stock ascending so the rows that need attention are
 * the ones on the first page.
 */
export async function listInventory(params: {
  page: number;
  pageSize: number;
  threshold?: number;
  q?: string;
}): Promise<Paged<InventoryRow>> {
  const where: Prisma.ProductVariantWhereInput = {
    ...(params.threshold !== undefined ? { stock: { lte: params.threshold } } : {}),
    ...(params.q
      ? {
          OR: [
            { sku: { contains: params.q, mode: "insensitive" as const } },
            { product: { title: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: [{ stock: "asc" }, { sku: "asc" }],
      ...paginate(params),
      select: {
        id: true,
        sku: true,
        size: true,
        colorName: true,
        stock: true,
        isActive: true,
        product: { select: { id: true, title: true, slug: true, isActive: true } },
      },
    }),
    prisma.productVariant.count({ where }),
  ]);

  return paged(
    rows.map((row) => ({
      variantId: row.id,
      sku: row.sku,
      size: row.size,
      colorName: row.colorName,
      stock: row.stock,
      isActive: row.isActive,
      productId: row.product.id,
      productTitle: row.product.title,
      productSlug: row.product.slug,
      productActive: row.product.isActive,
    })),
    total,
    params,
  );
}

/**
 * Absolute stock counts, applied in one transaction.
 *
 * Absolute rather than a delta on purpose. A capture may decrement any of these
 * rows while the operator is looking at the screen; `stock = 12` then means
 * "the shelf holds 12", which is a statement about the world and stays true,
 * whereas `stock += 3` layered on top of a concurrent sale silently invents
 * inventory. The window between the read and this write is a real one — it is
 * why the count an operator types can be wrong — but it cannot oversell,
 * because capture re-checks `stock >= qty` at the moment it decrements (SEC-5).
 */
export async function updateStock(
  input: StockUpdateInput,
): Promise<WriteResult<{ updated: number; slugs: string[] }>> {
  const ids = input.updates.map((update) => update.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: { id: true, product: { select: { slug: true } } },
  });
  if (variants.length !== ids.length) {
    return { ok: false, reason: "NOT_FOUND", message: "One of those variants is gone." };
  }

  await prisma.$transaction(
    input.updates.map((update) =>
      prisma.productVariant.update({
        where: { id: update.variantId },
        data: { stock: update.stock },
      }),
    ),
  );

  const slugs = Array.from(new Set(variants.map((variant) => variant.product.slug)));
  revalidateCatalog(slugs);
  return { ok: true, value: { updated: input.updates.length, slugs } };
}
