import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { categoryUpdateSchema } from "@/lib/validation/admin/catalog";
import { deleteCategory, updateCategory } from "@/server/admin/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH / DELETE /api/admin/categories/[id] */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/categories/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, categoryUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateCategory(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "category.update",
    target: id,
    detail: { fields: Object.keys(parsed.data) },
  });

  return jsonOk({ category: result.value });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/categories/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await deleteCategory(id);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "category.delete",
    target: id,
    detail: { slug: result.value.slug },
  });

  return jsonOk({ ok: true });
}
