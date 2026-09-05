import type { ProductDetail } from "@/server/catalog/queries";

/**
 * Structured data (F2).
 *
 * Rich results need `Product` with real offers, `BreadcrumbList`, and
 * `AggregateRating` — and every one of them has to agree with what the page
 * actually shows. Google treats structured data that contradicts the visible
 * page as spam, so all of this is built from the same objects the components
 * render, never from a parallel source.
 */

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The payload is our own data, but it is still interpolated into HTML.
      // Escaping "<" is what stops a product title containing "</script>" from
      // closing the tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export function ProductJsonLd({
  product,
  url,
  currency,
}: {
  product: ProductDetail;
  url: string;
  currency: string;
}) {
  const prices = product.variants.map((variant) => Number(variant.price));
  const inStock = product.variants.some((variant) => variant.stock > 0);
  const rating = Number(product.ratingAvg);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    sku: product.variants[0]?.sku,
    image: product.images,
    url,
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
    // One AggregateOffer for the price range, plus a per-variant Offer so a
    // shopper searching for a specific size sees accurate availability.
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: currency,
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: product.variants.length,
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      offers: product.variants.map((variant) => ({
        "@type": "Offer",
        sku: variant.sku,
        price: Number(variant.price).toFixed(2),
        priceCurrency: currency,
        availability:
          variant.stock > 0
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        url: `${url}?color=${encodeURIComponent(variant.colorName)}&size=${encodeURIComponent(variant.size)}`,
        itemCondition: "https://schema.org/NewCondition",
      })),
    },
  };

  // Only emitted when there are real reviews behind it. An AggregateRating with
  // a zero count is invalid structured data and a manual-action risk.
  if (product.ratingCount > 0 && rating > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: rating.toFixed(1),
      reviewCount: product.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return <JsonLd data={data} />;
}

export function BreadcrumbJsonLd({
  items,
  baseUrl,
}: {
  items: { name: string; path: string }[];
  baseUrl: string;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: new URL(item.path, baseUrl).toString(),
        })),
      }}
    />
  );
}

export function ItemListJsonLd({
  items,
  baseUrl,
}: {
  items: { slug: string; title: string }[];
  baseUrl: string;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.title,
          url: new URL(`/p/${item.slug}`, baseUrl).toString(),
        })),
      }}
    />
  );
}

export function WebSiteJsonLd({ baseUrl, name }: { baseUrl: string; name: string }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name,
        url: baseUrl,
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: new URL("/search?q={search_term_string}", baseUrl).toString(),
          },
          "query-input": "required name=search_term_string",
        },
      }}
    />
  );
}
