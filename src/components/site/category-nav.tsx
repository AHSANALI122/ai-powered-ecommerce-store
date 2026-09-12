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
    /*
     * A horizontal scroller on a phone, where six categories never fit.
     * The negative margin + padding lets it bleed to the screen edge, so the
     * last chip is visibly cut off rather than sitting flush against a
     * container edge that makes it look like the list simply ends — that hint
     * is what tells a thumb there is more to the right. Both scrollbars are
     * hidden (Firefox's property and WebKit's pseudo-element), and snapping
     * keeps a chip from being left half-scrolled.
     */
    <ul className="-mx-4 flex snap-x items-center gap-1 overflow-x-auto px-4 text-sm [-webkit-overflow-scrolling:touch] [scrollbar-width:none] sm:-mx-1 sm:gap-2 sm:px-1 [&::-webkit-scrollbar]:hidden">
      {tree.map((root) => (
        <li key={root.id} className="group relative shrink-0 snap-start">
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

/**
 * Keyword search. A plain GET form: linkable, crawlable, no JavaScript.
 *
 * `fullWidth` is the phone case. Inline in the header the field is a fixed
 * width that grows on focus, which is right when it shares a row with the
 * wordmark and the cart; on its own row below `sm` it should simply take the
 * width it has, and a width transition on an element that is already as wide
 * as its container is a transition to nowhere.
 */
export function SearchForm({
  defaultValue = "",
  fullWidth = false,
}: {
  defaultValue?: string;
  fullWidth?: boolean;
}) {
  // Both variants render in the header — one hidden — so a single hardcoded id
  // would be duplicated, and a label would point at whichever came first.
  const inputId = fullWidth ? "site-search-mobile" : "site-search";

  return (
    <form
      method="get"
      action="/search"
      role="search"
      className={`group flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)] pl-3 pr-1 py-1 transition-[border-color,box-shadow,width] duration-300 ease-[var(--ease-interaction)] focus-within:border-[var(--color-ink)] focus-within:shadow-[var(--shadow-card)] ${
        fullWidth ? "w-full" : ""
      }`}
    >
      <label htmlFor={inputId} className="sr-only">
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
        id={inputId}
        name="q"
        type="search"
        defaultValue={defaultValue}
        maxLength={80}
        placeholder="Search"
        className={
          fullWidth
            ? "w-full min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
            : "w-28 min-w-0 bg-transparent py-1 text-sm outline-none transition-[width] duration-300 ease-[var(--ease-interaction)] focus:w-40 sm:w-40 sm:focus:w-56"
        }
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
