import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";
import { listCategoryPaths, listProductSlugs } from "@/server/catalog/queries";

/**
 * Sitemap (F2).
 *
 * Only pages worth indexing: active products and categories. Account, auth,
 * cart, checkout and search are excluded — they are `noindex` and listing them
 * would be contradicting ourselves.
 *
 * Regenerated on the same window as the catalogue pages, so a new product
 * appears here without a deploy.
 */
export const revalidate = 300; // literal required: see CATALOG_REVALIDATE_SECONDS

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  const staticEntries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
  ];

  try {
    const [categories, products] = await Promise.all([
      listCategoryPaths(),
      listProductSlugs(),
    ]);

    return [
      ...staticEntries,
      ...categories.map((category) => ({
        url: new URL(category.path, base).toString(),
        lastModified: category.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
      ...products.map((product) => ({
        url: new URL(`/p/${product.slug}`, base).toString(),
        lastModified: product.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch {
    // A database blip should produce a small sitemap, not a 500 that makes a
    // crawler drop the file.
    return staticEntries;
  }
}
