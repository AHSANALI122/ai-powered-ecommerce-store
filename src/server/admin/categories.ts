import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
} from "@/lib/validation/admin/catalog";
import { revalidateCatalog } from "@/server/admin/revalidate";
import type { WriteResult } from "@/server/admin/products";

/**
 * Category administration (F4).
 *
 * The tree is two levels by decision, not by schema — Prisma cannot express a
 * depth limit, so spec §5 says application code enforces it. That enforcement
 * lives here, in three rules, all of which have to hold or `/c/[...slug]`
 * starts resolving paths it was never written for:
 *
 *  1. A category's parent must itself be a root.
 *  2. A category that already has children cannot be given a parent.
 *  3. A category cannot be its own parent.
 */

export interface AdminCategoryNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  position: number;
  isActive: boolean;
  parentId: string | null;
  productCount: number;
  children: AdminCategoryNode[];
}

const SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  image: true,
  position: true,
  isActive: true,
  parentId: true,
  _count: { select: { products: true } },
} as const;

export async function listAdminCategories(): Promise<AdminCategoryNode[]> {
  const rows = await prisma.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: SELECT,
  });

  const nodes = new Map<string, AdminCategoryNode>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        image: row.image,
        position: row.position,
        isActive: row.isActive,
        parentId: row.parentId,
        productCount: row._count.products,
        children: [],
      },
    ]),
  );

  const roots: AdminCategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Rules 1 and 3. `childId` is undefined on create, where there is no self to check. */
async function parentIsLegal(
  parentId: string,
  childId?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (childId && parentId === childId) {
    return { ok: false, message: "A category cannot be its own parent." };
  }
  const parent = await prisma.category.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true },
  });
  if (!parent) return { ok: false, message: "That parent category no longer exists." };
  if (parent.parentId !== null) {
    return { ok: false, message: "The category tree is only two levels deep." };
  }
  return { ok: true };
}

export async function createCategory(
  input: CategoryCreateInput,
): Promise<WriteResult<{ id: string; slug: string }>> {
  if (input.parentId) {
    const legal = await parentIsLegal(input.parentId);
    if (!legal.ok) return { ok: false, reason: "INVALID", message: legal.message };
  }

  try {
    const category = await prisma.category.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        image: input.image ?? null,
        position: input.position,
        isActive: input.isActive,
        parentId: input.parentId ?? null,
      },
      select: { id: true, slug: true },
    });
    revalidateCatalog();
    return { ok: true, value: category };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "SLUG_TAKEN", message: "That slug is already in use." };
    }
    throw error;
  }
}

export async function updateCategory(
  id: string,
  input: CategoryUpdateInput,
): Promise<WriteResult<{ id: string; slug: string }>> {
  const existing = await prisma.category.findUnique({
    where: { id },
    select: { id: true, _count: { select: { children: true } } },
  });
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND", message: "Category not found." };
  }

  if (input.parentId) {
    // Rule 2: a category with children of its own cannot become a child.
    if (existing._count.children > 0) {
      return {
        ok: false,
        reason: "INVALID",
        message: "This category has sub-categories, so it cannot become one itself.",
      };
    }
    const legal = await parentIsLegal(input.parentId, id);
    if (!legal.ok) return { ok: false, reason: "INVALID", message: legal.message };
  }

  try {
    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description ?? null }
          : {}),
        ...(input.image !== undefined ? { image: input.image ?? null } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId ?? null } : {}),
      },
      select: { id: true, slug: true },
    });
    revalidateCatalog();
    return { ok: true, value: category };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "SLUG_TAKEN", message: "That slug is already in use." };
    }
    throw error;
  }
}

/**
 * Refused while products still point at the category. `Product.categoryId` is
 * required and its relation has no `onDelete`, so Postgres would reject the
 * delete anyway — this turns a foreign-key error into a sentence explaining
 * what to do about it.
 */
export async function deleteCategory(id: string): Promise<WriteResult<{ slug: string }>> {
  const existing = await prisma.category.findUnique({
    where: { id },
    select: {
      slug: true,
      _count: { select: { products: true, children: true } },
    },
  });
  if (!existing)
    return { ok: false, reason: "NOT_FOUND", message: "Category not found." };

  if (existing._count.products > 0) {
    return {
      ok: false,
      reason: "INVALID",
      message: `Move its ${existing._count.products} product(s) elsewhere first.`,
    };
  }
  if (existing._count.children > 0) {
    return {
      ok: false,
      reason: "INVALID",
      message: "Delete or re-parent its sub-categories first.",
    };
  }

  await prisma.category.delete({ where: { id } });
  revalidateCatalog();
  return { ok: true, value: { slug: existing.slug } };
}
