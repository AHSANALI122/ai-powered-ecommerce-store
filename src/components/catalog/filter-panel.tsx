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
 */
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
  return (
    <form
      method="get"
      action={action}
      className="flex flex-col gap-6 text-sm"
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
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
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
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
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
                className="cursor-pointer rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs has-checked:border-[var(--color-ink)] has-checked:bg-[var(--color-ink)] has-checked:text-[var(--color-surface)]"
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
        <input type="checkbox" name="inStock" value="1" defaultChecked={query.inStock} />
        In stock only
      </label>

      {query.pageSize !== PAGE_SIZE_DEFAULT ? (
        <input type="hidden" name="pageSize" value={query.pageSize} />
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)]"
        >
          Apply
        </button>
        <a href={action} className="text-sm underline underline-offset-4">
          Clear
        </a>
      </div>
    </form>
  );
}
