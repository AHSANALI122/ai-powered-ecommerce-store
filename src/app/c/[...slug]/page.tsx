import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { publicEnv, serverEnv } from "@/lib/env";
import { parseCatalogQuery, buildCatalogSearch } from "@/lib/validation/catalog-query";
import { runtimeRoute } from "@/lib/routes";
import {
  getCanonicalCategoryPath,
  getFacets,
  listProducts,
  resolveCategoryPath,
} from "@/server/catalog/queries";
import { ProductGrid } from "@/components/catalog/product-card";
import { FilterPanel } from "@/components/catalog/filter-panel";
import { Pagination } from "@/components/catalog/pagination";
import { BreadcrumbJsonLd, ItemListJsonLd } from "@/components/seo/json-ld";

/**
 * Category listing (F2).
 *
 * Rendered per request because filters, sort and page all come from the query
 * string. The expensive part is bounded rather than cached: page size is capped
 * and sort is a whitelist (SEC-24), so no URL a visitor can construct turns
 * this into an unbounded scan.
 */

interface Params {
  slug: string[];
}

async function load(
  params: Promise<Params>,
  searchParams: Promise<Record<string, string | string[] | undefined>>,
) {
  const { slug } = await params;
  const query = parseCatalogQuery(await searchParams);

  const category = await resolveCategoryPath(slug);
  if (!category) {
    // A mis-shaped but real path (`/c/men-jeans`, `/c/women/men-jeans`) is a
    // link worth keeping: send it to the address the page actually lives at
    // rather than 404-ing, so link equity and the visitor both survive.
    const last = slug[slug.length - 1];
    const canonical = last ? await getCanonicalCategoryPath(last) : null;
    if (canonical) permanentRedirect(runtimeRoute(canonical));
    notFound();
  }

  return { category, query };
}

export async function generateMetadata(
  props: PageProps<"/c/[...slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await resolveCategoryPath(slug);
  if (!category) return { title: "Not found", robots: { index: false, follow: false } };

  const query = parseCatalogQuery(await props.searchParams);
  const filtered =
    query.size.length > 0 ||
    query.color.length > 0 ||
    query.brand.length > 0 ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined ||
    query.inStock === true;

  const title = category.parent
    ? `${category.parent.name} ${category.name}`
    : category.name;

  return {
    title,
    description:
      category.description ??
      `Shop ${title.toLowerCase()} — size and colour variants, worldwide shipping.`,
    alternates: {
      // Facet combinations are not separate pages worth indexing; page 2 is.
      canonical: `${category.path}${query.page > 1 ? `?page=${query.page}` : ""}`,
    },
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function CategoryPage(props: PageProps<"/c/[...slug]">) {
  const { category, query } = await load(props.params, props.searchParams);
  const currency = serverEnv().BASE_CURRENCY;

  const [page, facets] = await Promise.all([
    listProducts(query, { categoryIds: category.scopeIds }),
    getFacets({ categoryIds: category.scopeIds }),
  ]);

  const crumbs = [
    { name: "Home", path: "/" },
    ...(category.parent
      ? [{ name: category.parent.name, path: `/c/${category.parent.slug}` }]
      : []),
    { name: category.name, path: category.path },
  ];

  return (
    <div className="flex flex-col gap-8">
      <BreadcrumbJsonLd items={crumbs} baseUrl={publicEnv.NEXT_PUBLIC_APP_URL} />
      <ItemListJsonLd items={page.items} baseUrl={publicEnv.NEXT_PUBLIC_APP_URL} />

      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          {crumbs.map((crumb, index) => (
            <li key={crumb.path} className="flex items-center gap-2">
              {index < crumbs.length - 1 ? (
                <>
                  <Link href={runtimeRoute(crumb.path)} className="hover:underline">
                    {crumb.name}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              ) : (
                <span aria-current="page">{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{category.name}</h1>
        {category.description ? (
          <p className="max-w-prose text-sm text-[var(--color-muted)]">
            {category.description}
          </p>
        ) : null}
        <p className="text-sm text-[var(--color-muted)]">
          {page.total} {page.total === 1 ? "product" : "products"}
        </p>
        {category.children.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={runtimeRoute(`/c/${category.slug}/${child.slug}`)}
                  className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[16rem_1fr]">
        <aside>
          <FilterPanel action={category.path} query={query} facets={facets} />
        </aside>

        <div className="flex flex-col">
          <ProductGrid products={page.items} currency={currency} priorityCount={2} />
          <Pagination
            basePath={category.path}
            query={query}
            page={page.page}
            pageCount={page.pageCount}
          />
          {page.pageCount > 1 ? (
            <p className="pt-4 text-center text-xs text-[var(--color-muted)]">
              Page {page.page} of {page.pageCount}
              {query.page > 1 ? (
                <>
                  {" · "}
                  <Link
                    href={runtimeRoute(
                      `${category.path}${buildCatalogSearch(query, { page: 1 })}`,
                    )}
                    className="underline underline-offset-4"
                  >
                    back to the first page
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
