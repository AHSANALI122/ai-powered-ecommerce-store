import Link from "next/link";
import { getCategoryTree } from "@/server/catalog/queries";
import { runtimeRoute } from "@/lib/routes";

/**
 * Primary navigation, built from the two-level category tree.
 *
 * A server component with a database read and no request-time API, so it does
 * not opt the pages it appears in out of static rendering — which is the whole
 * reason the header carries no identity (see session-loader.tsx).
 *
 * A failure here degrades to "no nav" rather than to a 500: an unreachable
 * database should not take the site's shell down with it.
 */
export async function CategoryNav() {
  let tree: Awaited<ReturnType<typeof getCategoryTree>> = [];
  try {
    tree = await getCategoryTree();
  } catch {
    return null;
  }

  if (tree.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {tree.map((root) => (
        <li key={root.id} className="group relative">
          <Link
            href={runtimeRoute(`/c/${root.slug}`)}
            className="font-medium underline-offset-4 hover:underline"
          >
            {root.name}
          </Link>
          {root.children.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-muted)]">
              {root.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={runtimeRoute(`/c/${root.slug}/${child.slug}`)}
                    className="underline-offset-4 hover:underline"
                  >
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Keyword search. A plain GET form: linkable, crawlable, no JavaScript. */
export function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form method="get" action="/search" role="search" className="flex items-center gap-2">
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        maxLength={80}
        placeholder="Search"
        className="w-40 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm sm:w-56"
      />
      <button
        type="submit"
        className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
      >
        Go
      </button>
    </form>
  );
}
