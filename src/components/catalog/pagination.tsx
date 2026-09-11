import Link from "next/link";
import { buildCatalogSearch, type CatalogQuery } from "@/lib/validation/catalog-query";
import { runtimeRoute } from "@/lib/routes";

/**
 * Page links.
 *
 * Real `<a>` elements, so a crawler can follow them and the result set is
 * reachable without JavaScript. `rel=prev/next` tells a crawler these are one
 * sequence rather than a pile of near-duplicate pages.
 */
export function Pagination({
  basePath,
  query,
  page,
  pageCount,
}: {
  basePath: string;
  query: CatalogQuery;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) =>
    runtimeRoute(`${basePath}${buildCatalogSearch(query, { page: target })}`);

  // A window around the current page: a 40-page catalogue should not render 40
  // links, and "…" is clearer than an arbitrary truncation.
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4));
  const windowEnd = Math.min(pageCount, Math.max(page + 2, 5));
  const pages: number[] = [];
  for (let index = windowStart; index <= windowEnd; index += 1) pages.push(index);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-10">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          rel="prev"
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm transition-[border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)]"
        >
          Previous
        </Link>
      ) : null}

      {windowStart > 1 ? <span className="px-1 text-sm">…</span> : null}

      {pages.map((target) => (
        <Link
          key={target}
          href={href(target)}
          aria-current={target === page ? "page" : undefined}
          className="min-w-10 rounded-full border border-[var(--color-line)] px-3 py-1.5 text-center text-sm transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] aria-[current=page]:border-[var(--color-ink)] aria-[current=page]:bg-[var(--color-ink)] aria-[current=page]:text-[var(--color-surface)]"
        >
          {target}
        </Link>
      ))}

      {windowEnd < pageCount ? <span className="px-1 text-sm">…</span> : null}

      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          rel="next"
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm transition-[border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)]"
        >
          Next
        </Link>
      ) : null}
    </nav>
  );
}
