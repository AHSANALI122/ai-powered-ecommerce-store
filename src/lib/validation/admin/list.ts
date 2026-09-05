import { z } from "zod";

/**
 * The shape every admin listing endpoint accepts (SEC-24).
 *
 * Admin lists are the most attractive scraping surface in the application:
 * they are the only place that reads across all users' orders and every
 * unpublished product. So the same two bounds the storefront gets in
 * catalog-query.ts apply here, and for the same reasons:
 *
 *  - **`sort` is an opaque token, never a column name.** Each caller passes the
 *    tokens it understands and maps them to a hardcoded Prisma `orderBy`. A
 *    string from the query string never reaches the database as an identifier.
 *  - **The page size is capped.** `?pageSize=100000` against `/api/admin/orders`
 *    would dump the order book in one request.
 *
 * Unlike the storefront schema these `.catch()` nothing — an admin tool has no
 * "be forgiving to a shopper who edited the URL" requirement, and a silently
 * corrected parameter in an operator UI hides mistakes rather than absorbing
 * them.
 */

export const ADMIN_PAGE_SIZE_DEFAULT = 25;
export const ADMIN_PAGE_SIZE_MAX = 100;
export const ADMIN_PAGE_MAX = 500;

export const sortDirections = ["asc", "desc"] as const;
export type SortDirection = (typeof sortDirections)[number];

/**
 * Builds the list schema for one resource. `sortKeys` is the whitelist; the
 * first entry is the default, so a caller cannot end up with no ordering and a
 * non-deterministic page 2.
 */
export function adminListSchema<const Keys extends readonly [string, ...string[]]>(
  sortKeys: Keys,
) {
  return z
    .object({
      page: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(1),
      pageSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(ADMIN_PAGE_SIZE_MAX)
        .default(ADMIN_PAGE_SIZE_DEFAULT),
      sort: z.enum(sortKeys).default(sortKeys[0] as Keys[number]),
      dir: z.enum(sortDirections).default("desc"),
      /** Free-text filter. Bounded so it cannot become an expensive scan. */
      q: z.string().trim().min(1).max(80).optional(),
    })
    .strict();
}

export type AdminListQuery = z.infer<ReturnType<typeof adminListSchema>>;

/** Offset/limit for Prisma, derived only from already-validated values. */
export function paginate(query: { page: number; pageSize: number }) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export function paged<T>(
  items: T[],
  total: number,
  query: { page: number; pageSize: number },
): Paged<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
