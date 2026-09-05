import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { getAdminProduct } from "@/server/admin/products";
import { listAdminCategories } from "@/server/admin/categories";
import { ProductEditor } from "./product-editor";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

/** Product editor: fields on top, live variant rows below. */
export default async function AdminProductPage(props: PageProps<"/admin/products/[id]">) {
  const user = await requireRole("STAFF", "ADMIN");
  const { id } = await props.params;

  const [product, categories] = await Promise.all([
    getAdminProduct(id),
    listAdminCategories(),
  ]);
  if (!product) notFound();

  const options = categories.flatMap((root) => [
    { id: root.id, label: root.name },
    ...root.children.map((child) => ({
      id: child.id,
      label: `${root.name} → ${child.name}`,
    })),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{product.title}</h2>
          <p className="text-xs text-[var(--color-muted)]">
            {product.ratingCount} review{product.ratingCount === 1 ? "" : "s"} · average{" "}
            {product.ratingAvg} · updated {product.updatedAt.toISOString().slice(0, 10)}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href={`/p/${product.slug}`}
            className="underline underline-offset-4"
            prefetch={false}
          >
            View in store
          </Link>
          <Link href="/admin/products" className="underline underline-offset-4">
            Back to products
          </Link>
        </div>
      </div>

      <ProductEditor
        product={product}
        categories={options}
        canDelete={user.role === "ADMIN"}
      />
    </div>
  );
}
