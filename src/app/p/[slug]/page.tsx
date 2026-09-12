import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicEnv, serverEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import { getProductBySlug, listProductSlugs } from "@/server/catalog/queries";
import { VariantSelector } from "@/components/product/variant-selector";
import { ProductGallery } from "@/components/product/product-gallery";
import { BreadcrumbJsonLd, ProductJsonLd } from "@/components/seo/json-ld";
import { ProductReviews } from "@/components/reviews/product-reviews";
import { Stars } from "@/components/reviews/stars";
import { ProductPersonal } from "@/components/product/product-personal";

/**
 * Product detail (F2).
 *
 * Prerendered and revalidated on a window. The page itself never reads
 * `searchParams` — doing so would opt every product out of static rendering —
 * so the variant in `?color=&size=` is read by the client selector inside a
 * Suspense boundary. The server-rendered HTML therefore always shows a real,
 * in-stock-first variant with its true price and stock, and a deep link
 * refines it on hydration.
 *
 * Stale stock on a cached page cannot cause a wrong charge: checkout
 * revalidates price and availability against the database before payment, and
 * stock is decremented inside the verified-paid transaction (SEC-11, SEC-19).
 */
export const revalidate = 300; // literal required: see CATALOG_REVALIDATE_SECONDS
/** A product added since the last build renders on first request. */
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  /**
   * **Never in development.**
   *
   * The dev server does not call this in process: it forks a static-paths
   * worker (`next-dev-server.ts`, `maxRetries: 1`) and runs it there, on the
   * first request to this route and again after every HMR invalidation — so in
   * practice, on the first product page you open after each edit. That worker
   * would open a Neon WebSocket from a process torn down the moment the call
   * resolves, and a socket that errors after teardown takes the child with it.
   * jest-worker then retries once, loses the second child too, and the browser
   * gets "Jest worker encountered 2 child process exceptions, exceeding retry
   * limit" — a message with nothing in it that names this function.
   *
   * Nothing is lost by skipping it: `dynamicParams` is true, so a slug that is
   * not in this list renders on demand, which is what dev does with every page
   * anyway. It also takes the ~1.6s `generate-params` step off the first
   * product page after each edit.
   */
  if (process.env.NODE_ENV !== "production") return [];

  try {
    const products = await listProductSlugs();
    return products.map((product) => ({ slug: product.slug }));
  } catch {
    // No database at build time (CI): fall back to rendering on demand.
    return [];
  }
}

export async function generateMetadata(props: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Not found", robots: { index: false, follow: false } };

  const description = product.description.slice(0, 300);

  return {
    title: product.title,
    description,
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.title,
      description,
      url: `/p/${product.slug}`,
      images: product.images.slice(0, 1).map((url) => ({ url })),
    },
  };
}

export default async function ProductPage(props: PageProps<"/p/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const currency = serverEnv().BASE_CURRENCY;
  const baseUrl = publicEnv.NEXT_PUBLIC_APP_URL;
  const url = new URL(`/p/${product.slug}`, baseUrl).toString();

  const parent = product.category.parent;
  const categoryPath = parent
    ? `/c/${parent.slug}/${product.category.slug}`
    : `/c/${product.category.slug}`;

  const crumbs = [
    { name: "Home", path: "/" },
    ...(parent ? [{ name: parent.name, path: `/c/${parent.slug}` }] : []),
    { name: product.category.name, path: categoryPath },
    { name: product.title, path: `/p/${product.slug}` },
  ];

  // What the server renders before hydration: the first variant that can
  // actually be bought, so the visible price and stock are always real.
  const fallbackVariant =
    product.variants.find((variant) => variant.stock > 0) ?? product.variants[0];

  return (
    <div className="flex flex-col gap-10">
      <ProductJsonLd product={product} url={url} currency={currency} />
      <BreadcrumbJsonLd items={crumbs} baseUrl={baseUrl} />

      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          {crumbs.map((crumb, index) => (
            <li key={crumb.path} className="flex items-center gap-2">
              {index < crumbs.length - 1 ? (
                <>
                  <Link
                    href={runtimeRoute(crumb.path)}
                    className="transition-colors hover:text-[var(--color-ink)]"
                  >
                    {crumb.name}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              ) : (
                <span aria-current="page" className="truncate">
                  {crumb.name}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
        <ProductGallery images={product.images} title={product.title} />

        {/* Sticky on a wide screen so the price, the size picker and the
            add-to-cart button stay in view while the photographs scroll. */}
        <div className="flex flex-col gap-6 lg:sticky lg:top-28 lg:self-start">
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {product.title}
            </h1>
            {product.brand ? (
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                {product.brand}
              </p>
            ) : null}
            {product.ratingCount > 0 ? (
              <p className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                <Stars rating={Number(product.ratingAvg)} />
                <span className="tabular-nums">
                  {Number(product.ratingAvg).toFixed(1)} from {product.ratingCount}{" "}
                  {product.ratingCount === 1 ? "review" : "reviews"}
                </span>
              </p>
            ) : null}
          </header>

          {/* The selector reads ?color=&size= from the URL, which requires a
              Suspense boundary on a statically rendered route. The fallback is
              not a spinner: it is the same information, for the variant the
              server chose. */}
          <Suspense
            fallback={
              <div className="flex flex-col gap-6">
                <p className="text-2xl font-semibold tabular-nums">
                  {fallbackVariant
                    ? formatMoney(fallbackVariant.price, currency)
                    : formatMoney(product.basePrice, currency)}
                </p>
                <p className="text-sm text-[var(--color-muted)]">
                  {fallbackVariant && fallbackVariant.stock > 0 ? "In stock" : "Sold out"}
                </p>
              </div>
            }
          >
            <VariantSelector variants={product.variants} currency={currency} />
          </Suspense>

          {/* A client component, not a Suspense boundary around a server one:
              reading the session here would make this prerendered route
              dynamic. It reserves its height so nothing shifts (CLS). */}
          <ProductPersonal productId={product.id} slot="wishlist" />

          {/* `reveal` is the CSS scroll-timeline entrance from globals.css.
              It is used here rather than the `Reveal` component because this
              route is prerendered: a keyframe driven by the element's own
              position animates before hydration and costs no JavaScript. */}
          <section className="reveal flex flex-col gap-2 border-t border-[var(--color-line)] pt-6">
            <h2 className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
              Description
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-[var(--color-muted)]">
              {product.description}
            </p>
          </section>

          {Object.keys(product.attributes).length > 0 ? (
            <section className="reveal flex flex-col gap-2 border-t border-[var(--color-line)] pt-6">
              <h2 className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
                Details
              </h2>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
                {Object.entries(product.attributes).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="capitalize text-[var(--color-muted)]">{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>
      </div>

      {/* Streamed in: reviews are per-request (they include the caller's own,
          in any status), and the rest of this page stays static (F2). */}
      <Suspense
        fallback={
          <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-10">
            <div className="shimmer h-4 w-40 rounded-full" />
            <div className="shimmer h-3 w-full max-w-md rounded-full" />
            <div className="shimmer h-3 w-full max-w-sm rounded-full" />
          </div>
        }
      >
        <ProductReviews
          productId={product.id}
          slug={product.slug}
          ratingAvg={Number(product.ratingAvg)}
          ratingCount={product.ratingCount}
        />
      </Suspense>
    </div>
  );
}
