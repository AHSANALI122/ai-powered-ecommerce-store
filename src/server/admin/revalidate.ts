import { revalidateTag } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";

/**
 * Catalogue cache invalidation for admin writes (SEC-11).
 *
 * The storefront's cached reads are tagged in `src/server/catalog/queries.ts`;
 * this is the writer half of that contract. Without it an edit waits out the
 * 300-second revalidate window, which is survivable for a title and awkward for
 * a price or an out-of-stock flag.
 *
 * Staleness here is a *display* problem and never a charging one: checkout
 * recomputes every amount from the database (SEC-4), so the worst a missed
 * invalidation does is show an old price on a card until the timer catches up.
 *
 * Slug changes take both slugs. The old tag still guards a prerendered page at
 * the old URL, and leaving it valid is how a renamed product keeps serving its
 * previous content.
 *
 * **On the `"max"` profile.** Next 16 requires a second argument saying how long
 * stale content may still be served while the revalidation runs; the
 * single-argument form is deprecated and behaves like `{ expire: 0 }`, which
 * makes the next shopper's request a blocking cache miss. `"max"` is the
 * stale-while-revalidate option, and it is the right trade here for the same
 * reason the pages are cached at all: an admin edit is a display change, and
 * the amount anyone is charged is recomputed from the database at checkout
 * regardless (SEC-4). Nobody should wait on a page rebuild because someone in
 * the back office fixed a typo.
 *
 * `updateTag` — the read-your-own-writes variant — is not usable here: it is
 * only valid inside a Server Action, and these mutations arrive as route
 * handlers.
 */
const PROFILE = "max";

export function revalidateCatalog(slugs: readonly (string | null | undefined)[] = []) {
  revalidateTag(cacheTags.catalog, PROFILE);
  revalidateTag(cacheTags.productList, PROFILE);
  for (const slug of slugs) {
    if (slug) revalidateTag(cacheTags.product(slug), PROFILE);
  }
}
