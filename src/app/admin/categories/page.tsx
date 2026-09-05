import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { listAdminCategories } from "@/server/admin/categories";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

/** Category tree management. Two levels, enforced server-side (spec §5). */
export default async function AdminCategoriesPage() {
  await requireRole("STAFF", "ADMIN");
  const categories = await listAdminCategories();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          The tree is two levels deep: a top-level category and its sub-categories.
          Navigation and the <code>/c/…</code> routes are built from this shape, so a
          third level would have nowhere to render.
        </p>
      </div>

      <CategoryManager initialCategories={categories} />
    </div>
  );
}
