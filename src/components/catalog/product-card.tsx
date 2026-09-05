import Image from "next/image";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductCard as ProductCardData } from "@/server/catalog/queries";

/**
 * A product tile.
 *
 * `priority` is passed only for the handful of tiles above the fold — marking
 * every image high priority is the same as marking none, and it is a reliable
 * way to make LCP worse rather than better (spec §7).
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

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={`/p/${product.slug}`}
        className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-ink)]"
      >
        {/* Fixed aspect ratio: the box is laid out before the image loads, so
            nothing shifts when it arrives (CLS). */}
        <div className="relative aspect-3/4 overflow-hidden rounded-lg bg-black/5">
          {product.image ? (
            <Image
              src={product.image}
              alt={product.title}
              fill
              sizes={sizes}
              priority={priority}
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : null}
          {!product.inStock ? (
            <span className="absolute left-2 top-2 rounded bg-[var(--color-surface)]/90 px-2 py-1 text-xs font-medium">
              Sold out
            </span>
          ) : null}
        </div>
      </Link>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium leading-snug">
          <Link href={`/p/${product.slug}`}>{product.title}</Link>
        </h3>
        {product.brand ? (
          <p className="text-xs text-[var(--color-muted)]">{product.brand}</p>
        ) : null}

        <p className="text-sm">
          {formatMoney(product.priceFrom, currency)}
          {product.compareAtPrice ? (
            <span className="ml-2 text-xs text-[var(--color-muted)] line-through">
              {formatMoney(product.compareAtPrice, currency)}
            </span>
          ) : null}
        </p>

        {product.ratingCount > 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            <span aria-hidden="true">★</span> {rating.toFixed(1)}
            <span className="sr-only">out of 5</span> ({product.ratingCount})
          </p>
        ) : null}

        {product.colors.length > 0 ? (
          <ul className="mt-1 flex items-center gap-1.5" aria-label="Available colours">
            {product.colors.slice(0, 5).map((color) => (
              <li
                key={color.name}
                title={color.name}
                className="size-3 rounded-full border border-black/10"
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
      <p className="py-12 text-sm text-[var(--color-muted)]">
        Nothing matches those filters. Try widening them.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
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
