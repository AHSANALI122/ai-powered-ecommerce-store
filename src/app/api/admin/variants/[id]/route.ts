import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { variantUpdateSchema } from "@/lib/validation/admin/catalog";
import { deleteVariant, updateVariant } from "@/server/admin/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH / DELETE /api/admin/variants/[id]
 *
 * A variant id is globally unique, so this does not hang off the product path.
 * Every field is optional and the schema is `.strict()`, which means an update
 * that only moves stock carries only stock — there is no way to send a price
 * by accident because the form happened to have one in it.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/variants/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, variantUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateVariant(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "variant.update",
    target: id,
    detail: { sku: result.value.sku, fields: Object.keys(parsed.data) },
  });

  return jsonOk({ variant: result.value });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/variants/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await deleteVariant(id);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "variant.delete",
    target: id,
    detail: { sku: result.value.sku },
  });

  return jsonOk({ ok: true });
}
