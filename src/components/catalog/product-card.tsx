import Image from "next/image";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { Stars } from "@/components/reviews/stars";
import type { ProductCard as ProductCardData } from "@/server/catalog/queries";

/**
 * A product tile.
 *
 * `priority` is passed only for the handful of tiles above the fold — marking
 * every image high priority is the same as marking none, and it is a reliable
 * way to make LCP worse rather than better (spec §7).
 *
 * Everything that moves here moves on hover of the whole card, and only
 * `transform` and `opacity` move — the tile's box is laid out before the image
 * arrives and never changes size, so the grid cannot shift under a shopper's
 * cursor (CLS). The image scale is slow (700ms) on purpose: a fast zoom reads
 * as a jump, a slow one as depth.
 */
export function ProductCard({
  product,
  currency,
  priority = false,
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw",
}: {
  product: ProductCardData;
  currency: string;
  priority?: boolean;
  sizes?: string;
}) {
  const rating = Number(product.ratingAvg);
  const onOffer = Boolean(product.compareAtPrice);

  return (
    <article className="group flex h-full flex-col gap-3">
      <Link
        href={`/p/${product.slug}`}
        aria-label={product.title}
        className="block rounded-[var(--radius-card)]"
        tabIndex={-1}
      >
        {/* Fixed aspect ratio: the box is laid out before the image loads, so
            nothing shifts when it arrives (CLS). */}
        <div className="card-lift relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-subtle)]">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.title}
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover transition-transform duration-700 ease-[var(--ease-entrance)] group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : null}

          {/* Two overlays, both purely decorative: a permanent whisper of a
              gradient so a white garment on a white background still has an
              edge, and a stronger one that fades in under the hover caption so
              the text is legible over any photograph. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          />

          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between opacity-0 transition-[opacity,transform] duration-400 ease-[var(--ease-entrance)] group-hover:translate-y-0 group-hover:opacity-100">
            <span className="rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-black shadow-sm">
              View piece
            </span>
            {product.colors.length > 1 ? (
              <span className="rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
                {product.colors.length} colours
              </span>
            ) : null}
          </div>

          <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
            {!product.inStock ? (
              <span className="rounded-full bg-[var(--color-surface)]/92 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm">
                Sold out
              </span>
            ) : null}
            {onOffer && product.inStock ? (
              <span className="rounded-full bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent-ink)]">
                Sale
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1">
        {product.brand ? (
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
            {product.brand}
          </p>
        ) : null}

        <h3 className="text-sm font-medium leading-snug">
          {/* The title carries the accessible link; the image link above is
              taken out of the tab order so a keyboard user meets one stop per
              product rather than two identical ones. */}
          <Link href={`/p/${product.slug}`} className="link-sweep">
            {product.title}
          </Link>
        </h3>

        <p className="mt-0.5 flex items-baseline gap-2 text-sm tabular-nums">
          <span className={onOffer ? "font-semibold text-[var(--color-accent)]" : ""}>
            {formatMoney(product.priceFrom, currency)}
          </span>
          {product.compareAtPrice ? (
            <span className="text-xs text-[var(--color-muted)] line-through">
              {formatMoney(product.compareAtPrice, currency)}
            </span>
          ) : null}
        </p>

        {product.ratingCount > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <Stars rating={rating} />
            <span className="tabular-nums">
              {rating.toFixed(1)} ({product.ratingCount})
            </span>
          </p>
        ) : null}

        {product.colors.length > 0 ? (
          <ul className="mt-1.5 flex items-center gap-1.5" aria-label="Available colours">
            {product.colors.slice(0, 5).map((color) => (
              <li
                key={color.name}
                title={color.name}
                className="size-3.5 rounded-full border border-black/10 shadow-sm transition-transform duration-200 ease-[var(--ease-interaction)] hover:scale-125"
                style={{ backgroundColor: color.hex }}
              >
                <span className="sr-only">{color.name}</span>
              </li>
            ))}
            {product.colors.length > 5 ? (
              <li className="text-xs text-[var(--color-muted)]">
                +{product.colors.length - 5}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  currency,
  priorityCount = 0,
}: {
  products: ProductCardData[];
  currency: string;
  priorityCount?: number;
}) {
  if (products.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] py-16 text-center text-sm text-[var(--color-muted)]">
        Nothing matches those filters. Try widening them.
      </p>
    );
  }

  return (
    // `stagger` deals the tiles in rather than flashing the whole grid at once.
    // It is a CSS animation on children, so a server-rendered grid gets it with
    // no client component and it is neutralised by reduced-motion like the rest.
    <ul className="stagger grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            currency={currency}
            priority={index < priorityCount}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The grid's loading state.
 *
 * Same geometry as the real tile — aspect ratio, gaps, the two text lines — so
 * the skeleton is replaced rather than resized, and a slow filtered listing
 * looks like it is loading rather than broken.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="flex flex-col gap-3">
          <div className="shimmer aspect-3/4 rounded-[var(--radius-card)]" />
          <div className="shimmer h-3 w-2/3 rounded-full" />
          <div className="shimmer h-3 w-1/3 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
