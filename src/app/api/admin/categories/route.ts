import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { categoryCreateSchema } from "@/lib/validation/admin/catalog";
import { createCategory, listAdminCategories } from "@/server/admin/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / POST /api/admin/categories
 *
 * Not paginated: the tree is two levels deep and a clothing store has tens of
 * categories, not thousands. If that ever stops being true the listing needs
 * the same treatment as products — the cap is the rule, not the exception.
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  return jsonOk({ categories: await listAdminCategories() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, categoryCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createCategory(parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "category.create",
    target: result.value.id,
    detail: { slug: result.value.slug },
  });

  return jsonOk({ category: result.value }, { status: 201 });
}
