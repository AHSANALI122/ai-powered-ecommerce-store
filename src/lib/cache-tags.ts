/**
 * Cache tag vocabulary (SEC-11).
 *
 * Catalogue pages are ISR-cached, which means a price shown to a shopper can
 * be older than the price in the database. That is only safe because checkout
 * recomputes every amount from the database (SEC-4) — a cached page can never
 * cause an incorrect charge, only an out-of-date display.
 *
 * Even so, staleness should be short. F4's admin mutations call
 * `revalidateTag` with these tags so an edit propagates immediately instead of
 * waiting for the revalidate window. Defining the vocabulary here keeps the
 * writer and the reader spelling the tag the same way.
 */

export const cacheTags = {
  /** Everything catalogue-shaped. Use sparingly: it invalidates all listings. */
  catalog: "catalog",
  product: (slug: string) => `product:${slug}`,
  category: (slug: string) => `category:${slug}`,
  /** Listings that would change shape when any product is added or removed. */
  productList: "product-list",
} as const;

/**
 * Revalidate window for catalogue pages, in seconds.
 *
 * Short enough that a missed tag invalidation self-heals within minutes,
 * long enough that a crawl or a traffic spike does not become a database load
 * test.
 *
 * **This cannot be imported into a `export const revalidate` segment config.**
 * Next reads that export by static analysis at build time, not by evaluating
 * the module: `revalidate = 300` is valid, `revalidate = SOME_CONSTANT` (or
 * `60 * 5`) is not, and the build fails with "Invalid segment configuration
 * export detected". The pages therefore repeat the literal `300`, and
 * cache-tags.test.ts asserts they still agree with this value.
 */
export const CATALOG_REVALIDATE_SECONDS = 300;
