import { z } from "zod";

/**
 * The only way a URL reaches the catalogue query layer (SEC-24).
 *
 * Two attacks this closes:
 *
 *  - **User-controlled sort column.** `?sort=passwordHash` must never become
 *    an `orderBy` key. `sort` is an enum here and is mapped to a hardcoded
 *    Prisma `orderBy` object in queries.ts — a raw column name from the URL
 *    never reaches the database.
 *  - **Unbounded pagination.** `?pageSize=100000` is a free denial-of-service
 *    and a convenient scraper. The page size is capped and the page number is
 *    bounded.
 *
 * Everything is `.catch()`-ed to a sane default rather than erroring: a
 * shopper who edits the URL should get a sensible page, not a 400. The bound
 * is what matters, not the complaint.
 */

export const PAGE_SIZE_DEFAULT = 24;
export const PAGE_SIZE_MAX = 48;
export const PAGE_MAX = 200;

/** Sort keys are opaque tokens; queries.ts owns what each one means. */
export const SORT_KEYS = [
  "newest",
  "price-asc",
  "price-desc",
  "rating",
  "relevance",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const GENDERS = ["MEN", "WOMEN", "UNISEX"] as const;

/** A repeated param arrives as an array, a single one as a string. */
const stringArray = (maxItems: number, maxLength: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .pipe(
      z
        .array(z.string().trim().min(1).max(maxLength))
        .max(maxItems)
        .transform((values) => Array.from(new Set(values))),
    )
    .catch([]);

const positiveInt = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).catch(fallback);

const money = z.coerce.number().min(0).max(100_000_000).optional().catch(undefined);

export const catalogQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional().catch(undefined),
    page: positiveInt(1, PAGE_MAX),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).catch(PAGE_SIZE_DEFAULT),
    sort: z.enum(SORT_KEYS).catch("newest"),
    minPrice: money,
    maxPrice: money,
    size: stringArray(12, 16),
    color: stringArray(16, 32),
    brand: stringArray(12, 64),
    gender: z.enum(GENDERS).optional().catch(undefined),
    inStock: z
      .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
      .transform((value) => value === "1" || value === "true")
      .optional()
      .catch(undefined),
  })
  // Not `.strict()`: unknown query params (a campaign tag, a tracking id) are
  // ordinary on a public URL and must not break the page. Strictness belongs on
  // request *bodies*, where an unexpected key is an attempt at something.
  .transform((value) => {
    // A reversed range is a typo, not an attack; swapping beats an empty page.
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      value.minPrice > value.maxPrice
    ) {
      return { ...value, minPrice: value.maxPrice, maxPrice: value.minPrice };
    }
    return value;
  });

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** Parses Next's `searchParams` object (values are string | string[] | undefined). */
export function parseCatalogQuery(
  params: Record<string, string | string[] | undefined>,
): CatalogQuery {
  return catalogQuerySchema.parse(params);
}

/** Rebuilds a query string for pagination and filter links, dropping defaults. */
export function buildCatalogSearch(
  query: CatalogQuery,
  overrides: Partial<CatalogQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.sort !== "newest") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize !== PAGE_SIZE_DEFAULT)
    params.set("pageSize", String(merged.pageSize));
  if (merged.minPrice !== undefined) params.set("minPrice", String(merged.minPrice));
  if (merged.maxPrice !== undefined) params.set("maxPrice", String(merged.maxPrice));
  if (merged.gender) params.set("gender", merged.gender);
  if (merged.inStock) params.set("inStock", "1");
  for (const size of merged.size) params.append("size", size);
  for (const color of merged.color) params.append("color", color);
  for (const brand of merged.brand) params.append("brand", brand);

  const search = params.toString();
  return search ? `?${search}` : "";
}
