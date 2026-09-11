import Image from "next/image";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { runtimeRoute } from "@/lib/routes";
import type { SuggestedProduct } from "@/components/assistant/suggestions";

/**
 * The products an answer named, shown as pictures.
 *
 * A shopping assistant that describes a linen shirt in words is asking someone
 * to imagine a garment they came here to look at. These are the same tiles the
 * storefront uses, shrunk to a chat panel: a fixed 3:4 box so the strip is laid
 * out before any image arrives and the conversation does not jump when they do
 * (CLS), and a horizontal scroller because two and a half cards visible is what
 * tells a shopper there are more to the right.
 *
 * Every value here came from a tool result — see suggestions.ts for why that
 * matters and what is checked before it gets this far. The card is a `Link` to
 * the product page and nothing else: no add-to-cart button, because a click
 * that spends nothing needs no confirmation and a click that does belongs on a
 * page with the size picker on it.
 */
export function ProductSuggestions({ products }: { products: SuggestedProduct[] }) {
  if (products.length === 0) return null;

  return (
    <ul
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1"
      aria-label="Products mentioned in this answer"
    >
      {products.map((product) => (
        <li key={product.slug} className="w-36 shrink-0 snap-start">
          <Link
            href={runtimeRoute(product.url)}
            className="group flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)] focus-visible:ring-offset-2"
          >
            <div className="relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-subtle)]">
              {product.image ? (
                <Image
                  src={product.image}
                  alt={product.title}
                  fill
                  sizes="144px"
                  className="object-cover transition-transform duration-500 ease-[var(--ease-entrance)] group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              ) : null}

              {!product.inStock ? (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-[var(--color-surface)]/92 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                  Sold out
                </span>
              ) : null}
            </div>

            <p className="line-clamp-2 text-xs font-medium leading-snug">
              {product.title}
            </p>

            {product.price ? (
              <p className="text-xs text-[var(--color-muted)]">
                {formatMoney(product.price, product.currency)}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
