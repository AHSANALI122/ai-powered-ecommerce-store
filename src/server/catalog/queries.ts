import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Gender } from "@/generated/prisma/enums";
import type { CatalogQuery, SortKey } from "@/lib/validation/catalog-query";
import { CATALOG_REVALIDATE_SECONDS, cacheTags } from "@/lib/cache-tags";

/**
 * Why the reads below are wrapped in `unstable_cache`.
 *
 * The prerendered pages (`/`, `/p/[slug]`, `sitemap.xml`) would otherwise only
 * be refreshable by waiting out their revalidate window. Tagging the data is
 * what makes the vocabulary in cache-tags.ts real: F4's admin mutations call
 * `revalidateTag(cacheTags.product(slug))` and the affected page rebuilds on
 * the next request (SEC-11). An untagged read leaves `revalidateTag` a no-op
 * and the timer the only lever.
 *
 * The filtered listing and search paths are deliberately *not* cached — those
 * pages render per request, so there is nothing stale to invalidate, and the
 * key cardinality of free-text search would make the cache a liability.
 */
const CACHE_OPTIONS = { revalidate: CATALOG_REVALIDATE_SECONDS } as const;

/**
 * Catalogue reads (F2).
 *
 * Everything the storefront displays comes from here, and nothing here trusts
 * a URL directly: callers pass a `CatalogQuery` that has already been through
 * the Zod schema, so page sizes are capped and `sort` is one of five known
 * tokens mapped below to a hardcoded `orderBy` (SEC-24).
 *
 * Prices leave this module as strings. A `Decimal` cannot cross the server →
 * client boundary, and turning one into a JS `number` on the way is exactly the
 * bug AD-6 exists to prevent.
 */

// ---------------------------------------------------------------------------
// Shapes returned to the UI
// ---------------------------------------------------------------------------

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  gender: Gender;
  image: string | null;
  /** Lowest active variant price, falling back to the product's base price. */
  priceFrom: string;
  compareAtPrice: string | null;
  ratingAvg: string;
  ratingCount: number;
  inStock: boolean;
  colors: { name: string; hex: string }[];
}

export interface ProductVariantView {
  id: string;
  size: string;
  colorName: string;
  colorHex: string;
  sku: string;
  /** Effective price: `variant.price ?? product.basePrice` (AD-5). */
  price: string;
  stock: number;
  isActive: boolean;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  brand: string | null;
  gender: Gender;
  basePrice: string;
  compareAtPrice: string | null;
  images: string[];
  attributes: Record<string, string>;
  ratingAvg: string;
  ratingCount: number;
  category: { slug: string; name: string; parent: { slug: string; name: string } | null };
  variants: ProductVariantView[];
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  children: { id: string; slug: string; name: string }[];
}

export interface Facets {
  sizes: string[];
  colors: { name: string; hex: string }[];
  brands: string[];
  priceRange: { min: string; max: string } | null;
}

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Sorting: the whitelist (SEC-24)
// ---------------------------------------------------------------------------

/**
 * The only orderings that exist. A token that is not a key here cannot be
 * expressed, which is why `sort` is an enum in the schema rather than a string
 * passed through to Prisma.
 */
const ORDER_BY: Record<SortKey, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "asc" }],
  "price-asc": [{ basePrice: "asc" }, { id: "asc" }],
  "price-desc": [{ basePrice: "desc" }, { id: "asc" }],
  rating: [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { id: "asc" }],
  // Relevance only means something for a search; elsewhere it degrades to
  // newest rather than erroring on a URL a user may have edited by hand.
  relevance: [{ createdAt: "desc" }, { id: "asc" }],
};

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function buildWhere(
  query: CatalogQuery,
  scope: { categoryIds?: string[]; ids?: string[] } = {},
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { isActive: true };

  if (scope.categoryIds) where.categoryId = { in: scope.categoryIds };
  if (scope.ids) where.id = { in: scope.ids };
  if (query.gender) where.gender = query.gender;
  if (query.brand.length > 0) where.brand = { in: query.brand };

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    // Filtered on basePrice, which is the advertised "from" price. A variant
    // override can put a specific size outside the range; the listing is a
    // browsing aid, and the price actually charged is recomputed at checkout
    // from the chosen variant (SEC-4).
    where.basePrice = {
      ...(query.minPrice !== undefined
        ? { gte: new Prisma.Decimal(query.minPrice) }
        : {}),
      ...(query.maxPrice !== undefined
        ? { lte: new Prisma.Decimal(query.maxPrice) }
        : {}),
    };
  }

  // Size, colour and availability live on the variant (AD-5), so they are
  // expressed as "has at least one active variant matching all of these".
  const variantWhere: Prisma.ProductVariantWhereInput = { isActive: true };
  let hasVariantFilter = false;
  if (query.size.length > 0) {
    variantWhere.size = { in: query.size };
    hasVariantFilter = true;
  }
  if (query.color.length > 0) {
    variantWhere.colorName = { in: query.color };
    hasVariantFilter = true;
  }
  if (query.inStock) {
    variantWhere.stock = { gt: 0 };
    hasVariantFilter = true;
  }
  if (hasVariantFilter) where.variants = { some: variantWhere };

  return where;
}

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  brand: true,
  gender: true,
  images: true,
  basePrice: true,
  compareAtPrice: true,
  ratingAvg: true,
  ratingCount: true,
  variants: {
    where: { isActive: true },
    select: { price: true, stock: true, colorName: true, colorHex: true },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(row: CardRow): ProductCard {
  const prices = row.variants.map((variant) => variant.price ?? row.basePrice);
  const lowest = prices.reduce<Prisma.Decimal>(
    (min, price) => (price.lessThan(min) ? price : min),
    prices[0] ?? row.basePrice,
  );

  const colors = new Map<string, { name: string; hex: string }>();
  for (const variant of row.variants) {
    if (!colors.has(variant.colorName)) {
      colors.set(variant.colorName, { name: variant.colorName, hex: variant.colorHex });
    }
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    brand: row.brand,
    gender: row.gender,
    image: row.images[0] ?? null,
    priceFrom: lowest.toString(),
    compareAtPrice: row.compareAtPrice?.toString() ?? null,
    ratingAvg: row.ratingAvg.toString(),
    ratingCount: row.ratingCount,
    inStock: row.variants.some((variant) => variant.stock > 0),
    colors: [...colors.values()],
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export async function listProducts(
  query: CatalogQuery,
  scope: { categoryIds?: string[]; ids?: string[] } = {},
): Promise<ProductPage> {
  const where = buildWhere(query, scope);
  const take = query.pageSize;
  const skip = (query.page - 1) * take;

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: CARD_SELECT,
      orderBy: ORDER_BY[query.sort],
      take,
      skip,
    }),
  ]);

  let items = rows.map(toCard);

  // A relevance sort has to be applied in application code: the ranking came
  // from the trigram query, and Postgres has no memory of it in this second
  // statement.
  if (query.sort === "relevance" && scope.ids) {
    const rank = new Map(scope.ids.map((id, index) => [id, index]));
    items = items.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return {
    items,
    total,
    page: query.page,
    pageSize: take,
    pageCount: Math.max(1, Math.ceil(total / take)),
  };
}

export const listFeaturedProducts = unstable_cache(
  async (limit = 8): Promise<ProductCard[]> => {
    const rows = await prisma.product.findMany({
      where: { isActive: true, isFeatured: true },
      select: CARD_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toCard);
  },
  ["catalog", "featured"],
  { ...CACHE_OPTIONS, tags: [cacheTags.catalog, cacheTags.productList] },
);

export const listNewArrivals = unstable_cache(
  async (limit = 8): Promise<ProductCard[]> => {
    const rows = await prisma.product.findMany({
      where: { isActive: true },
      select: CARD_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(toCard);
  },
  ["catalog", "new-arrivals"],
  { ...CACHE_OPTIONS, tags: [cacheTags.catalog, cacheTags.productList] },
);

// ---------------------------------------------------------------------------
// Search (pg_trgm)
// ---------------------------------------------------------------------------

interface SearchRow {
  id: string;
}

/**
 * Keyword search over the trigram GIN indexes on `title` and `brand`.
 *
 * Returns product ids in relevance order; the caller re-queries them with the
 * ordinary filters applied. Two passes rather than one statement, because the
 * filters are already expressed safely in Prisma — this keeps the raw SQL down
 * to one parameterised similarity query with no interpolated user input.
 *
 * `<%` is pg_trgm's *word* similarity, which scores the search term against the
 * best-matching run of words in the title rather than against the whole string.
 * That distinction is the difference between finding and missing: plain
 * `similarity('Linen Camp Collar Shirt', 'linnen')` is far below threshold,
 * while `'linnen' <% title` matches, because it only has to resemble "Linen".
 * The ILIKE arm then catches substrings and short terms that no trigram measure
 * will clear.
 */
export async function searchProductIds(term: string, limit = 300): Promise<string[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const pattern = `%${trimmed}%`;

  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT "id"
    FROM "Product"
    WHERE "isActive" = true
      AND (
        ${trimmed} <% "title"
        OR ${trimmed} <% COALESCE("brand", '')
        OR "title" ILIKE ${pattern}
        OR "brand" ILIKE ${pattern}
      )
    ORDER BY
      GREATEST(
        word_similarity(${trimmed}, "title"),
        word_similarity(${trimmed}, COALESCE("brand", ''))
      ) DESC,
      "createdAt" DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

async function readProductBySlug(slug: string): Promise<ProductDetail | null> {
  const row = await prisma.product.findFirst({
    where: { slug, isActive: true },
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
      category: {
        select: {
          slug: true,
          name: true,
          parent: { select: { slug: true, name: true } },
        },
      },
      variants: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { size: "asc" }],
        select: {
          id: true,
          size: true,
          colorName: true,
          colorHex: true,
          sku: true,
          price: true,
          stock: true,
          isActive: true,
        },
      },
    },
  });

  if (!row) return null;

  const attributes: Record<string, string> = {};
  if (
    row.attributes &&
    typeof row.attributes === "object" &&
    !Array.isArray(row.attributes)
  ) {
    for (const [key, value] of Object.entries(row.attributes)) {
      if (typeof value === "string") attributes[key] = value;
    }
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    brand: row.brand,
    gender: row.gender,
    basePrice: row.basePrice.toString(),
    compareAtPrice: row.compareAtPrice?.toString() ?? null,
    images: row.images,
    attributes,
    ratingAvg: row.ratingAvg.toString(),
    ratingCount: row.ratingCount,
    category: {
      slug: row.category.slug,
      name: row.category.name,
      parent: row.category.parent,
    },
    variants: row.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      colorName: variant.colorName,
      colorHex: variant.colorHex,
      sku: variant.sku,
      // The one rule the whole variant model exists for (AD-5).
      price: (variant.price ?? row.basePrice).toString(),
      stock: variant.stock,
      isActive: variant.isActive,
    })),
  };
}

/**
 * The tag is per-product, so editing one product invalidates only its page.
 * `unstable_cache` is built here rather than at module scope because the tag
 * depends on the argument; the slug also joins the cache key, so entries stay
 * one-per-product.
 */
export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  return unstable_cache(readProductBySlug, ["catalog", "product"], {
    ...CACHE_OPTIONS,
    tags: [cacheTags.catalog, cacheTags.product(slug)],
  })(slug);
}

/** Slugs of every active product, for the sitemap. */
export const listProductSlugs = unstable_cache(
  async (): Promise<{ slug: string; updatedAt: Date }[]> =>
    prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ["catalog", "product-slugs"],
  { ...CACHE_OPTIONS, tags: [cacheTags.catalog, cacheTags.productList] },
);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const getCategoryTree = unstable_cache(
  async (): Promise<CategoryNode[]> => {
    const roots = await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        children: {
          where: { isActive: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: { id: true, slug: true, name: true },
        },
      },
    });
    return roots;
  },
  ["catalog", "category-tree"],
  { ...CACHE_OPTIONS, tags: [cacheTags.catalog] },
);

export interface ResolvedCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parent: { slug: string; name: string } | null;
  children: { id: string; slug: string; name: string }[];
  /** The category itself plus, for a parent, all of its children. */
  scopeIds: string[];
  /** Canonical URL path for this category. */
  path: string;
}

/**
 * Resolves a `/c/...` path to a category, enforcing that the URL matches the
 * real tree.
 *
 * `/c/women/men-jeans` must 404 rather than quietly render men's jeans under a
 * women's breadcrumb: one page reachable at two URLs is a duplicate-content
 * problem, and a breadcrumb that disagrees with the URL is a lying breadcrumb.
 */
export async function resolveCategoryPath(
  segments: string[],
): Promise<ResolvedCategory | null> {
  if (segments.length === 0 || segments.length > 2) return null;

  const slug = segments[segments.length - 1];
  if (!slug) return null;

  const category = await prisma.category.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      parent: { select: { slug: true, name: true } },
      children: {
        where: { isActive: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, slug: true, name: true },
      },
    },
  });

  if (!category) return null;

  const expectedParent = segments.length === 2 ? segments[0] : undefined;
  if (expectedParent !== undefined) {
    if (category.parent?.slug !== expectedParent) return null;
  } else if (category.parent) {
    // A child category is only canonical at /c/<parent>/<child>.
    return null;
  }

  const path = category.parent
    ? `/c/${category.parent.slug}/${category.slug}`
    : `/c/${category.slug}`;

  return {
    ...category,
    scopeIds: [category.id, ...category.children.map((child) => child.id)],
    path,
  };
}

/**
 * The canonical path for a category slug, regardless of how it was reached.
 *
 * Used to redirect a non-canonical URL (`/c/men-jeans`, or `/c/women/men-jeans`)
 * to the one address the page really lives at, instead of 404-ing a link that
 * is merely mis-shaped.
 */
export async function getCanonicalCategoryPath(slug: string): Promise<string | null> {
  const category = await prisma.category.findFirst({
    where: { slug, isActive: true },
    select: { slug: true, parent: { select: { slug: true } } },
  });
  if (!category) return null;
  return category.parent
    ? `/c/${category.parent.slug}/${category.slug}`
    : `/c/${category.slug}`;
}

/** Every category path, for the sitemap and the nav. */
export const listCategoryPaths = unstable_cache(
  async (): Promise<{ path: string; updatedAt: Date }[]> => {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        updatedAt: true,
        parent: { select: { slug: true } },
      },
    });

    return categories.map((category) => ({
      path: category.parent
        ? `/c/${category.parent.slug}/${category.slug}`
        : `/c/${category.slug}`,
      updatedAt: category.updatedAt,
    }));
  },
  ["catalog", "category-paths"],
  { ...CACHE_OPTIONS, tags: [cacheTags.catalog, cacheTags.productList] },
);

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

/**
 * Available filter values for a scope.
 *
 * Deliberately computed from the category scope alone, not from the currently
 * applied filters: a filter list that removes its own options as you use them
 * traps the user in a corner they cannot get out of without editing the URL.
 */
export async function getFacets(scope: { categoryIds?: string[] } = {}): Promise<Facets> {
  const productWhere: Prisma.ProductWhereInput = {
    isActive: true,
    ...(scope.categoryIds ? { categoryId: { in: scope.categoryIds } } : {}),
  };

  const [brands, variants, priceRange] = await Promise.all([
    prisma.product.findMany({
      where: { ...productWhere, brand: { not: null } },
      distinct: ["brand"],
      select: { brand: true },
      orderBy: { brand: "asc" },
    }),
    prisma.productVariant.findMany({
      where: { isActive: true, product: productWhere },
      distinct: ["size", "colorName"],
      select: { size: true, colorName: true, colorHex: true },
    }),
    prisma.product.aggregate({
      where: productWhere,
      _min: { basePrice: true },
      _max: { basePrice: true },
    }),
  ]);

  const colors = new Map<string, { name: string; hex: string }>();
  for (const variant of variants) {
    if (!colors.has(variant.colorName)) {
      colors.set(variant.colorName, { name: variant.colorName, hex: variant.colorHex });
    }
  }

  // Apparel sizes have a meaningful order that is neither alphabetical nor
  // numeric across both scales, so it is stated rather than derived.
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"];
  const sizes = [...new Set(variants.map((variant) => variant.size))].sort((a, b) => {
    const indexA = SIZE_ORDER.indexOf(a);
    const indexB = SIZE_ORDER.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return Number(a) - Number(b) || a.localeCompare(b);
  });

  return {
    sizes,
    colors: [...colors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    brands: brands
      .map((row) => row.brand)
      .filter((brand): brand is string => brand !== null),
    priceRange:
      priceRange._min.basePrice && priceRange._max.basePrice
        ? {
            min: priceRange._min.basePrice.toString(),
            max: priceRange._max.basePrice.toString(),
          }
        : null,
  };
}
