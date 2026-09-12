import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Playfair_Display } from "next/font/google";
import { publicEnv } from "@/lib/env";
import { SessionLoader } from "@/components/auth/session-loader";
import { AccountNav } from "@/components/site/account-nav";
import { DemoBanner } from "@/components/site/demo-banner";
import { CategoryNav, SearchForm } from "@/components/site/category-nav";
import { CartLink } from "@/components/cart/cart-link";
import { WebSiteJsonLd } from "@/components/seo/json-ld";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { assistantAvailable } from "@/server/assistant/config";
import "./globals.css";

/**
 * Two families, one job each: a grotesque for everything you operate — prices,
 * sizes, buttons, form labels — and a serif for the things you read, which on
 * a clothing site is the wordmark and the section headings. `display: "swap"`
 * with `next/font` means text paints in the fallback immediately and never
 * blocks the LCP element on a font file (spec §7).
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: {
    default: `${publicEnv.NEXT_PUBLIC_SITE_NAME} — Modern apparel, worldwide`,
    template: `%s · ${publicEnv.NEXT_PUBLIC_SITE_NAME}`,
  },
  description:
    "Men's and women's clothing with worldwide shipping. Size and colour variants, honest stock, fast delivery.",
  robots: { index: true, follow: true },
};

/**
 * The shell is deliberately identity-free on the server: nothing here reads
 * cookies, so a catalogue page can still be prerendered and ISR-cached (F2).
 * The category nav is a database read with no request-time API, which is
 * cacheable; the account state is filled in by the client afterwards (see
 * session-loader.tsx).
 *
 * The header is sticky and solid: an opaque surface with a border, the same at
 * the top of the page as it is halfway down it. Deliberately not a scroll-
 * reactive one — a header that changes as you scroll is a header whose contrast
 * you have to reason about twice, and the fixed one never has content showing
 * faintly through the nav.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
      <body className="min-h-full antialiased">
        <DemoBanner />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-[var(--color-surface)]"
        >
          Skip to content
        </a>
        <SessionLoader />
        <WebSiteJsonLd
          baseUrl={publicEnv.NEXT_PUBLIC_APP_URL}
          name={publicEnv.NEXT_PUBLIC_SITE_NAME}
        />

        {/* Facts, not marketing: PKR is the single base currency (spec §4) and
            worldwide shipping is what this store is. */}
        <div className="border-b border-[var(--color-line)] bg-[var(--color-ink)] text-[var(--color-surface)]">
          <p className="mx-auto max-w-6xl px-4 py-2 text-center text-[10px] uppercase tracking-[0.12em] sm:px-6 sm:text-[11px] sm:tracking-[0.18em]">
            Worldwide shipping · Prices in PKR · Real-time stock
          </p>
        </div>

        <header className="sticky top-0 z-40 border-b border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
            {/*
              Three things compete for the top row — the wordmark, search, and
              the account controls — and on a 360px screen only two of them
              fit. `flex-wrap` used to be the answer and it is the wrong one:
              a wrapped search field lands under the wordmark at whatever width
              is left over, which is the broken header people actually see.

              Below `sm` the field becomes an icon that goes to /search, which
              renders the real one. Giving it a row of its own was the other
              option and it costs about 50px — on a header that is already
              sticky and already carries a category scroller, that is a quarter
              of a phone screen permanently spent on chrome.
            */}
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/"
                className="font-display min-w-0 truncate text-lg font-semibold tracking-tight transition-opacity hover:opacity-70 sm:text-2xl"
              >
                {publicEnv.NEXT_PUBLIC_SITE_NAME}
              </Link>
              <div className="flex shrink-0 items-center gap-3 sm:gap-6">
                <div className="hidden sm:block">
                  <SearchForm />
                </div>
                <Link
                  href="/search"
                  aria-label="Search products"
                  className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-subtle)] sm:hidden"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <circle cx="9" cy="9" r="6" />
                    <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
                  </svg>
                </Link>
                <CartLink />
                <nav aria-label="Account">
                  <AccountNav />
                </nav>
              </div>
            </div>

            <nav aria-label="Primary">
              <CategoryNav />
            </nav>
          </div>
        </header>

        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 sm:px-6">
          <main id="main" className="flex-1 py-8 sm:py-10">
            {children}
          </main>

          <footer className="mt-8 border-t border-[var(--color-line)] py-10">
            <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-xs">
                <p className="font-display text-lg font-semibold tracking-tight">
                  {publicEnv.NEXT_PUBLIC_SITE_NAME}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  Men&apos;s and women&apos;s clothing, shipped worldwide. Sizes and
                  colours are shown from live stock, and totals are always confirmed by
                  the server before you pay.
                </p>
              </div>
              <nav
                aria-label="Footer"
                className="grid grid-cols-2 gap-8 text-sm sm:flex sm:gap-12"
              >
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                    Shop
                  </p>
                  <Link href="/c/men" className="link-sweep w-fit">
                    Men
                  </Link>
                  <Link href="/c/women" className="link-sweep w-fit">
                    Women
                  </Link>
                  <Link href="/search" className="link-sweep w-fit">
                    Search
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">
                    Account
                  </p>
                  <Link href="/account/orders" className="link-sweep w-fit">
                    Orders
                  </Link>
                  <Link href="/account/wishlist" className="link-sweep w-fit">
                    Wishlist
                  </Link>
                  <Link href="/cart" className="link-sweep w-fit">
                    Cart
                  </Link>
                </div>
              </nav>
            </div>
            <p className="mt-8 border-t border-[var(--color-line)] pt-6 text-xs text-[var(--color-muted)]">
              © {new Date().getFullYear()} {publicEnv.NEXT_PUBLIC_SITE_NAME}
            </p>
          </footer>
        </div>

        {/*
          Outside the page container so its fixed positioning is not scoped by
          an ancestor transform, and rendered last so it is never in the way of
          the LCP element. `assistantAvailable()` reads env, not cookies, so
          this stays a static read and the catalogue pages stay cacheable (F2).
        */}
        <AssistantLauncher available={assistantAvailable()} />
      </body>
    </html>
  );
}
