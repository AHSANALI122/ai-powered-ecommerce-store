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
 *
 * **The submenu is CSS, not state.** `group-hover` opens it for a mouse and
 * `group-focus-within` opens it for a keyboard, so it works on prerendered
 * HTML with JavaScript still loading, and there is no `aria-expanded` lying
 * about a button that does not exist. On touch there is no hover: tapping the
 * parent goes to the category page, which lists the same children. The panel
 * is `invisible`, not `hidden`, so it can animate — and invisible content is
 * out of the tab order, which `display: none` would also have given us but
 * without the transition.
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
    <ul className="-mx-1 flex items-center gap-1 overflow-x-auto text-sm [scrollbar-width:none] sm:gap-2">
      {tree.map((root) => (
        <li key={root.id} className="group relative shrink-0">
          <Link
            href={runtimeRoute(`/c/${root.slug}`)}
            className="link-sweep inline-block rounded-full px-3 py-1.5 font-medium tracking-wide transition-colors hover:bg-[var(--color-subtle)]"
          >
            {root.name}
          </Link>

          {root.children.length > 0 ? (
            <div className="pointer-events-none invisible absolute left-0 top-full z-30 min-w-44 translate-y-1 pt-2 opacity-0 transition-[opacity,transform] duration-200 ease-[var(--ease-entrance)] group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
              <ul className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-2 shadow-[var(--shadow-panel)]">
                {root.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={runtimeRoute(`/c/${root.slug}/${child.slug}`)}
                      className="block rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-subtle)] hover:text-[var(--color-ink)]"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Keyword search. A plain GET form: linkable, crawlable, no JavaScript. */
export function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form
      method="get"
      action="/search"
      role="search"
      className="group flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)] pl-3 pr-1 py-1 transition-[border-color,box-shadow,width] duration-300 ease-[var(--ease-interaction)] focus-within:border-[var(--color-ink)] focus-within:shadow-[var(--shadow-card)]"
    >
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-4 shrink-0 text-[var(--color-muted)] transition-colors group-focus-within:text-[var(--color-ink)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
      </svg>
      <input
        id="site-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        maxLength={80}
        placeholder="Search"
        className="w-28 min-w-0 bg-transparent py-1 text-sm outline-none transition-[width] duration-300 ease-[var(--ease-interaction)] focus:w-40 sm:w-40 sm:focus:w-56"
      />
      <button
        type="submit"
        className="rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-surface)] transition-transform duration-200 ease-[var(--ease-interaction)] hover:brightness-110 active:translate-y-px"
      >
        Go
      </button>
    </form>
  );
}
