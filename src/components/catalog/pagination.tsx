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

  // Five numbers plus Previous and Next is about 410px of controls, which does
  // not fit a 360px screen. The numbers past the third are dropped below `sm`
  // rather than wrapped onto a second line: Previous, Next and the page you are
  // on are what a thumb uses, and a two-row pagination block reads as broken.
  // The full window comes back from `sm` up.
  const NARROW_WINDOW = 3;
  const narrowStart = Math.max(1, Math.min(page - 1, pageCount - (NARROW_WINDOW - 1)));
  const narrowEnd = Math.min(pageCount, narrowStart + NARROW_WINDOW - 1);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-center gap-2 pt-10"
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          rel="prev"
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm transition-[border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)]"
        >
          Previous
        </Link>
      ) : null}

      {/* The ellipsis has to track whichever window is actually visible, or a
          phone showing pages 2–4 claims page 1 is not there. */}
      {windowStart > 1 || narrowStart > 1 ? (
        <span className={`px-1 text-sm ${windowStart > 1 ? "" : "sm:hidden"}`}>…</span>
      ) : null}

      {pages.map((target) => (
        <Link
          key={target}
          href={href(target)}
          aria-current={target === page ? "page" : undefined}
          className={`min-w-10 rounded-full border border-[var(--color-line)] px-3 py-1.5 text-center text-sm transition-[border-color,background-color,transform] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] aria-[current=page]:border-[var(--color-ink)] aria-[current=page]:bg-[var(--color-ink)] aria-[current=page]:text-[var(--color-surface)] ${
            target >= narrowStart && target <= narrowEnd ? "" : "hidden sm:inline-block"
          }`}
        >
          {target}
        </Link>
      ))}

      {windowEnd < pageCount || narrowEnd < pageCount ? (
        <span className={`px-1 text-sm ${windowEnd < pageCount ? "" : "sm:hidden"}`}>
          …
        </span>
      ) : null}

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
