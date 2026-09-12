import type { CatalogQuery } from "@/lib/validation/catalog-query";
import { PAGE_SIZE_DEFAULT } from "@/lib/validation/catalog-query";
import type { Facets } from "@/server/catalog/queries";

/**
 * Filters and sort.
 *
 * A plain GET form, no JavaScript. Submitting produces exactly the URL the
 * server already knows how to parse and bound (SEC-24), which means filters
 * work with JS disabled, are linkable and shareable, and cost nothing in
 * bundle size on a page whose Core Web Vitals matter (F2 DoD).
 *
 * `page` is deliberately not carried through: changing a filter should return
 * you to page one, not to page seven of a different result set.
 *
 * **Collapsed below `lg`.** In a single column this panel sits above the grid,
 * and every colour and brand in the catalogue is a row — which on a phone
 * means a shopper opening a category scrolls past a wall of checkboxes before
 * reaching a single product. So it is a disclosure on small screens and the
 * permanent sidebar it always was from `lg` up.
 *
 * The toggle is a checkbox and a label rather than `<details>` or a button:
 * `<details>` has no way to be forced open at a breakpoint without JavaScript
 * (its content hiding is a UA behaviour, not a `display` this file can
 * override), and a button would need state on a page that deliberately ships
 * no client component here. `peer-checked:block lg:block` means the desktop
 * rule wins whatever the checkbox happens to hold, so resizing a window never
 * leaves the sidebar hidden.
 */
function countActiveFilters(query: CatalogQuery): number {
  return (
    query.size.length +
    query.color.length +
    query.brand.length +
    (query.minPrice ? 1 : 0) +
    (query.maxPrice ? 1 : 0) +
    (query.inStock ? 1 : 0)
  );
}

export function FilterPanel({
  action,
  query,
  facets,
  showSearchField = false,
}: {
  action: string;
  query: CatalogQuery;
  facets: Facets;
  showSearchField?: boolean;
}) {
  const activeCount = countActiveFilters(query);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="checkbox"
        id="filter-disclosure"
        className="peer sr-only"
        defaultChecked={false}
      />
      <label
        htmlFor="filter-disclosure"
        // The chevron is a descendant of this label, not a sibling of the
        // checkbox, so the rotation has to be written as a nested selector —
        // a bare `peer-checked:rotate-180` on the span compiles to a sibling
        // combinator that matches nothing.
        className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] px-4 py-3 text-sm font-medium shadow-[var(--shadow-card)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)] peer-checked:[&>[data-chevron]]:rotate-180 lg:hidden"
      >
        <span className="flex items-center gap-2">
          Filters &amp; sort
          {activeCount > 0 ? (
            <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-accent-ink)]">
              {activeCount}
            </span>
          ) : null}
        </span>
        <span
          data-chevron
          aria-hidden="true"
          className="text-xs text-[var(--color-muted)] transition-transform duration-200"
        >
          ▾
        </span>
      </label>

      <div className="hidden peer-checked:block lg:block">
        <form
          method="get"
          action={action}
          className="flex flex-col gap-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-4 text-sm lg:border-0 lg:bg-transparent lg:p-0"
          aria-label="Filter and sort products"
        >
          {showSearchField ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="filter-q" className="font-medium">
                Search
              </label>
              <input
                id="filter-q"
                name="q"
                type="search"
                defaultValue={query.q ?? ""}
                maxLength={80}
                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-elevated)] px-3 py-2 outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--color-ink)] focus:shadow-[var(--shadow-card)]"
              />
            </div>
          ) : query.q ? (
            <input type="hidden" name="q" value={query.q} />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-sort" className="font-medium">
              Sort
            </label>
            <select
              id="filter-sort"
              name="sort"
              defaultValue={query.sort}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-elevated)] px-3 py-2 outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--color-ink)] focus:shadow-[var(--shadow-card)]"
            >
              {showSearchField ? <option value="relevance">Relevance</option> : null}
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="rating">Rating</option>
            </select>
          </div>

          {facets.sizes.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">Size</legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {facets.sizes.map((size) => (
                  <label
                    key={size}
                    className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] has-checked:border-[var(--color-ink)] has-checked:bg-[var(--color-ink)] has-checked:text-[var(--color-surface)]"
                  >
                    <input
                      type="checkbox"
                      name="size"
                      value={size}
                      defaultChecked={query.size.includes(size)}
                      className="sr-only"
                    />
                    {size}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {facets.colors.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">Colour</legend>
              <div className="flex flex-col gap-1.5 pt-1">
                {facets.colors.map((color) => (
                  <label key={color.name} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="color"
                      value={color.name}
                      defaultChecked={query.color.includes(color.name)}
                    />
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full border border-black/10"
                      style={{ backgroundColor: color.hex }}
                    />
                    {color.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {facets.brands.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="font-medium">Brand</legend>
              <div className="flex flex-col gap-1.5 pt-1">
                {facets.brands.map((brand) => (
                  <label key={brand} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="brand"
                      value={brand}
                      defaultChecked={query.brand.includes(brand)}
                    />
                    {brand}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">Price</legend>
            <div className="flex items-center gap-2 pt-1">
              <label className="sr-only" htmlFor="filter-min">
                Minimum price
              </label>
              <input
                id="filter-min"
                name="minPrice"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder={facets.priceRange?.min ?? "Min"}
                defaultValue={query.minPrice ?? ""}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5"
              />
              <span aria-hidden="true">–</span>
              <label className="sr-only" htmlFor="filter-max">
                Maximum price
              </label>
              <input
                id="filter-max"
                name="maxPrice"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder={facets.priceRange?.max ?? "Max"}
                defaultValue={query.maxPrice ?? ""}
                className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5"
              />
            </div>
          </fieldset>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="inStock"
              value="1"
              defaultChecked={query.inStock}
            />
            In stock only
          </label>

          {query.pageSize !== PAGE_SIZE_DEFAULT ? (
            <input type="hidden" name="pageSize" value={query.pageSize} />
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-surface)]"
            >
              Apply
            </button>
            <a href={action} className="text-sm underline underline-offset-4">
              Clear
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
