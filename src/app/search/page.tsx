import type { Metadata } from "next";
import { serverEnv } from "@/lib/env";
import { parseCatalogQuery } from "@/lib/validation/catalog-query";
import { getFacets, listProducts, searchProductIds } from "@/server/catalog/queries";
import { ProductGrid } from "@/components/catalog/product-card";
import { FilterPanel } from "@/components/catalog/filter-panel";
import { Pagination } from "@/components/catalog/pagination";

/**
 * Keyword search (F2).
 *
 * Two passes: a trigram query ranks candidate ids using the pg_trgm GIN index,
 * then the ordinary filtered listing runs over that id set. Keeping the raw SQL
 * to one parameterised similarity query means the filters stay in Prisma, where
 * they are already bounded and whitelisted (SEC-24).
 *
 * `noindex, follow`: a search results page is not content worth indexing, but
 * the products it links to are.
 */
export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage(props: PageProps<"/search">) {
  const params = await props.searchParams;
  const query = parseCatalogQuery(params);
  const currency = serverEnv().BASE_CURRENCY;
  const term = query.q ?? "";

  if (!term) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Type a product, brand or material into the search box above.
        </p>
      </div>
    );
  }

  const ids = await searchProductIds(term);

  // No candidates: skip the second query entirely rather than asking Postgres
  // for products whose id is in an empty set.
  const [page, facets] = await Promise.all([
    ids.length > 0
      ? listProducts({ ...query, sort: query.sort }, { ids })
      : Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: query.pageSize,
          pageCount: 1,
        }),
    getFacets(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Results for “{term}”</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {page.total} {page.total === 1 ? "match" : "matches"}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[16rem_1fr]">
        <aside>
          <FilterPanel action="/search" query={query} facets={facets} showSearchField />
        </aside>

        <div className="flex flex-col">
          {page.items.length === 0 ? (
            <div className="flex flex-col gap-2 py-12">
              <p className="text-sm">Nothing matched that.</p>
              <p className="text-sm text-[var(--color-muted)]">
                Try a shorter term, a brand name, or browse a category from the menu
                above.
              </p>
            </div>
          ) : (
            <ProductGrid products={page.items} currency={currency} priorityCount={2} />
          )}
          <Pagination
            basePath="/search"
            query={query}
            page={page.page}
            pageCount={page.pageCount}
          />
        </div>
      </div>
    </div>
  );
}
