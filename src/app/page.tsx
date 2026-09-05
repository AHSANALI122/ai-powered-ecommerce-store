import Link from "next/link";
import { serverEnv } from "@/lib/env";
import {
  listFeaturedProducts,
  listNewArrivals,
  type ProductCard as ProductCardData,
} from "@/server/catalog/queries";
import { ProductGrid } from "@/components/catalog/product-card";
import { HeroCarousel, type HeroSlide } from "@/components/home/hero-carousel";

/**
 * Home.
 *
 * Statically rendered and revalidated on a window (ISR): nothing on this page
 * is per-visitor, so every shopper can be served the same prerendered HTML.
 * That is only possible because the header carries no identity — see the
 * comment in layout.tsx.
 */
export const revalidate = 300; // literal required: see CATALOG_REVALIDATE_SECONDS

function toSlides(products: ProductCardData[]): HeroSlide[] {
  return products.slice(0, 4).map((product) => ({
    id: product.id,
    title: product.title,
    subtitle: product.brand ?? "Featured",
    href: `/p/${product.slug}`,
    image: product.image,
    cta: "Shop this piece",
  }));
}

function SetupNotice({ reason }: { reason: string }) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] p-6">
      <h1 className="text-xl font-semibold">The app is up; the database is not</h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
        The site renders, but no products could be read. Point{" "}
        <code className="rounded bg-black/5 px-1">DATABASE_URL</code> at a Neon database,
        then run the migration and the seed:
      </p>
      <pre className="mt-4 overflow-x-auto rounded bg-black/5 p-4 text-xs leading-relaxed">
        {`cp .env.example .env      # fill in DATABASE_URL
npm run db:migrate        # applies prisma/migrations
npm run db:seed           # demo catalogue`}
      </pre>
      <p className="mt-4 text-xs text-[var(--color-muted)]">Reported: {reason}</p>
    </section>
  );
}

export default async function HomePage() {
  const currency = serverEnv().BASE_CURRENCY;

  let featured: ProductCardData[];
  let arrivals: ProductCardData[];
  try {
    [featured, arrivals] = await Promise.all([
      listFeaturedProducts(8),
      listNewArrivals(8),
    ]);
  } catch (error) {
    return (
      <SetupNotice
        reason={error instanceof Error ? error.message : "Unknown database error"}
      />
    );
  }

  if (featured.length === 0 && arrivals.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] p-6">
        <h1 className="text-xl font-semibold">Database connected, catalogue empty</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Run <code className="rounded bg-black/5 px-1">npm run db:seed</code> to load the
          demo catalogue.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <HeroCarousel slides={toSlides(featured.length > 0 ? featured : arrivals)} />

      {featured.length > 0 ? (
        <section className="flex flex-col gap-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">Featured</h2>
            <Link href="/c/men" className="text-sm underline underline-offset-4">
              Shop men
            </Link>
          </div>
          {/* The carousel owns the LCP image, so nothing below it is
              prioritised — competing priorities are the same as none. */}
          <ProductGrid products={featured} currency={currency} />
        </section>
      ) : null}

      <section className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">New arrivals</h2>
          <Link href="/c/women" className="text-sm underline underline-offset-4">
            Shop women
          </Link>
        </div>
        <ProductGrid products={arrivals} currency={currency} />
      </section>
    </div>
  );
}
