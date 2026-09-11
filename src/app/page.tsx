import Link from "next/link";
import { serverEnv } from "@/lib/env";
import {
  listFeaturedProducts,
  listNewArrivals,
  type ProductCard as ProductCardData,
} from "@/server/catalog/queries";
import { ProductGrid } from "@/components/catalog/product-card";
import { HeroCarousel, type HeroSlide } from "@/components/home/hero-carousel";
import { Reveal } from "@/components/home/reveal";

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
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-6 shadow-[var(--shadow-card)]">
      <h1 className="font-display text-xl font-semibold">
        The app is up; the database is not
      </h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
        The site renders, but no products could be read. Point{" "}
        <code className="rounded bg-[var(--color-subtle)] px-1">DATABASE_URL</code> at a
        Neon database, then run the migration and the seed:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--color-subtle)] p-4 text-xs leading-relaxed">
        {`cp .env.example .env      # fill in DATABASE_URL
npm run db:migrate        # applies prisma/migrations
npm run db:seed           # demo catalogue`}
      </pre>
      <p className="mt-4 text-xs text-[var(--color-muted)]">Reported: {reason}</p>
    </section>
  );
}

/**
 * A section heading.
 *
 * The eyebrow carries the editorial voice and the rule under the title is what
 * gives the page rhythm without another border. The rule draws itself in when
 * the heading is hovered — a small thing, and the only decoration on the page
 * that is purely decorative.
 */
function SectionHeading({
  eyebrow,
  title,
  linkHref,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          {eyebrow}
        </p>
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
      </div>
      <Link
        href={linkHref}
        className="group inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <span className="link-sweep">{linkLabel}</span>
        <span
          aria-hidden="true"
          className="transition-transform duration-300 ease-[var(--ease-interaction)] group-hover:translate-x-1"
        >
          →
        </span>
      </Link>
    </div>
  );
}

/**
 * Three things that are true of this store, not three marketing claims: stock
 * is read live (F2), the server recomputes every total before payment (SEC-4),
 * and returns are the operator's policy page rather than a promise made here.
 */
function Promises() {
  const items = [
    {
      title: "Live stock",
      body: "Sizes and colours come from the catalogue as it is right now, not a nightly export.",
    },
    {
      title: "Server-checked totals",
      body: "Prices and availability are recomputed at checkout, so what you see is what you pay.",
    },
    {
      title: "Worldwide shipping",
      body: "Rates are calculated per destination before you are asked for payment.",
    },
  ];

  return (
    <ul className="stagger grid gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <li
          key={item.title}
          className="card-lift rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-5"
        >
          <p className="text-sm font-medium">{item.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted)]">
            {item.body}
          </p>
        </li>
      ))}
    </ul>
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
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-6 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-xl font-semibold">
          Database connected, catalogue empty
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Run{" "}
          <code className="rounded bg-[var(--color-subtle)] px-1">npm run db:seed</code>{" "}
          to load the demo catalogue.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <HeroCarousel slides={toSlides(featured.length > 0 ? featured : arrivals)} />

      <Promises />

      {featured.length > 0 ? (
        // The hero is deliberately outside every Reveal: it holds the LCP
        // element, and an element that starts transparent cannot be a fast
        // largest paint.
        <Reveal>
          <section className="flex flex-col gap-8">
            <SectionHeading
              eyebrow="Chosen by us"
              title="Featured"
              linkHref="/c/men"
              linkLabel="Shop men"
            />
            {/* The carousel owns the LCP image, so nothing below it is
                prioritised — competing priorities are the same as none. */}
            <ProductGrid products={featured} currency={currency} />
          </section>
        </Reveal>
      ) : null}

      <Reveal delay={0.05}>
        <section className="flex flex-col gap-8">
          <SectionHeading
            eyebrow="Just landed"
            title="New arrivals"
            linkHref="/c/women"
            linkLabel="Shop women"
          />
          <ProductGrid products={arrivals} currency={currency} />
        </section>
      </Reveal>
    </div>
  );
}
