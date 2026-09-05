import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { listAdminCategories } from "@/server/admin/categories";
import { NewProductForm } from "./new-product-form";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

/**
 * Product creation.
 *
 * Categories are loaded on the server so the picker cannot offer one that does
 * not exist; the create endpoint re-checks the id anyway, because a category
 * can be deleted between this render and the submit.
 */
export default async function NewProductPage() {
  await requireRole("STAFF", "ADMIN");

  const categories = await listAdminCategories();
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
        <h2 className="text-lg font-semibold">New product</h2>
        <Link href="/admin/products" className="text-sm underline underline-offset-4">
          Back to products
        </Link>
      </div>

      {options.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-sm"
        >
          There are no categories yet, and every product needs one.{" "}
          <Link href="/admin/categories" className="underline underline-offset-4">
            Create a category first
          </Link>
          .
        </p>
      ) : (
        <NewProductForm categories={options} />
      )}
    </div>
  );
}
