import type { Metadata } from "next";
import Link from "next/link";
import { runtimeRoute } from "@/lib/routes";
import { requireRole } from "@/lib/auth/current-user";
import { serverEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { productListSchema } from "@/lib/validation/admin/catalog";
import { LOW_STOCK_THRESHOLD, listAdminProducts } from "@/server/admin/products";
import { listAdminCategories } from "@/server/admin/categories";
import { Badge, EmptyState, Pager, TableScroll, Td, Th } from "@/components/admin/table";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

/**
 * Product listing.
 *
 * The URL is the state — filters, sort and page are all query parameters — so a
 * view is linkable and the back button behaves. The parse is `safeParse` with a
 * fallback rather than the API's hard rejection: an operator who edits the URL
 * or arrives from a stale bookmark should land on a sensible page, and the
 * bounds are enforced either way because both paths go through the same schema.
 */
export default async function AdminProductsPage(props: PageProps<"/admin/products">) {
  await requireRole("STAFF", "ADMIN");

  const params = await props.searchParams;
  const parsed = productListSchema.safeParse(flatten(params));
  const query = parsed.success ? parsed.data : productListSchema.parse({});

  const currency = serverEnv().BASE_CURRENCY;
  const [page, categories] = await Promise.all([
    listAdminProducts(query),
    listAdminCategories(),
  ]);

  const flatCategories = categories.flatMap((root) => [
    { id: root.id, label: root.name },
    ...root.children.map((child) => ({
      id: child.id,
      label: `${root.name} → ${child.name}`,
    })),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Products</h2>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)]"
        >
          New product
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-line)] p-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Title, slug, brand or SKU"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Category</span>
          <select
            name="categoryId"
            defaultValue={query.categoryId ?? ""}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {flatCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={query.status}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Hidden</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Sort</span>
          <select
            name="sort"
            defaultValue={query.sort}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="createdAt">Newest</option>
            <option value="updatedAt">Recently edited</option>
            <option value="title">Title</option>
            <option value="basePrice">Base price</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
        >
          Apply
        </button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState>
          No products match this filter.{" "}
          <Link href="/admin/products/new" className="underline underline-offset-4">
            Create one
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          <TableScroll>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Category</Th>
                <Th align="right">Base price</Th>
                <Th align="right">Variants</Th>
                <Th align="right">Stock</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((product) => (
                <tr key={product.id}>
                  <Td>
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="font-medium underline underline-offset-4"
                    >
                      {product.title}
                    </Link>
                    <div className="text-xs text-[var(--color-muted)]">
                      /{product.slug}
                      {product.source === "pexels" ? " · demo data" : ""}
                    </div>
                  </Td>
                  <Td>{product.categoryName}</Td>
                  <Td align="right">{formatMoney(product.basePrice, currency)}</Td>
                  <Td align="right">{product.variantCount}</Td>
                  <Td align="right">
                    {product.variantCount === 0 ? (
                      <Badge tone="bad">no variants</Badge>
                    ) : (
                      <Badge tone={product.lowStock ? "warn" : "neutral"}>
                        {product.totalStock}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {product.isActive ? (
                      <Badge tone="good">live</Badge>
                    ) : (
                      <Badge>hidden</Badge>
                    )}
                    {product.isFeatured ? <Badge>featured</Badge> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableScroll>

          <Pager
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            buildHref={(next) =>
              runtimeRoute(`/admin/products${buildSearch(params, next)}`)
            }
          />
        </>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        Stock is the sum across a product&rsquo;s variants; a product is flagged when any
        active variant sits at or below {LOW_STOCK_THRESHOLD} units.
      </p>
    </div>
  );
}

/** Next hands repeated params as arrays; the schema expects one value per key. */
function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") out[key] = first;
  }
  return out;
}

function buildSearch(
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams(flatten(params));
  search.set("page", String(page));
  return `?${search.toString()}`;
}
