import type { Metadata } from "next";
import Link from "next/link";
import { publicEnv } from "@/lib/env";
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
        <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6">
          <header className="flex items-center justify-between border-b border-[var(--color-line)] py-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              {publicEnv.NEXT_PUBLIC_SITE_NAME}
            </Link>
            <nav aria-label="Primary" className="text-sm text-[var(--color-muted)]">
              <span>Catalogue arrives in F2</span>
            </nav>
          </header>
          <main id="main" className="flex-1 py-10">
            {children}
          </main>
          <footer className="border-t border-[var(--color-line)] py-6 text-sm text-[var(--color-muted)]">
            © {new Date().getFullYear()} {publicEnv.NEXT_PUBLIC_SITE_NAME}
          </footer>
        </div>
      </body>
    </html>
  );
}
