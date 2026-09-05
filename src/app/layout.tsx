import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/env";
import { SessionLoader } from "@/components/auth/session-loader";
import { AccountNav } from "@/components/site/account-nav";
import { CategoryNav, SearchForm } from "@/components/site/category-nav";
import { CartLink } from "@/components/cart/cart-link";
import { WebSiteJsonLd } from "@/components/seo/json-ld";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { assistantAvailable } from "@/server/assistant/config";
import "./globals.css";

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
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-black focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <SessionLoader />
        <WebSiteJsonLd
          baseUrl={publicEnv.NEXT_PUBLIC_APP_URL}
          name={publicEnv.NEXT_PUBLIC_SITE_NAME}
        />
        <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6">
          <header className="flex flex-col gap-4 border-b border-[var(--color-line)] py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                {publicEnv.NEXT_PUBLIC_SITE_NAME}
              </Link>
              <div className="flex items-center gap-6">
                <SearchForm />
                <CartLink />
                <nav aria-label="Account">
                  <AccountNav />
                </nav>
              </div>
            </div>
            <nav aria-label="Primary">
              <CategoryNav />
            </nav>
          </header>
          <main id="main" className="flex-1 py-10">
            {children}
          </main>
          <footer className="border-t border-[var(--color-line)] py-6 text-sm text-[var(--color-muted)]">
            © {new Date().getFullYear()} {publicEnv.NEXT_PUBLIC_SITE_NAME}
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
