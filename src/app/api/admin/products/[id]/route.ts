import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { productUpdateSchema } from "@/lib/validation/admin/catalog";
import { deleteProduct, getAdminProduct, updateProduct } from "@/server/admin/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET / PATCH / DELETE /api/admin/products/[id] */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/admin/products/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const product = await getAdminProduct(id);
  if (!product) return jsonError("NOT_FOUND", "Product not found.");

  return jsonOk({ product });
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/products/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, productUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateProduct(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "product.update",
    target: id,
    detail: { fields: Object.keys(parsed.data) },
  });

  return jsonOk({ product: result.value });
}

/**
 * ADMIN only, not STAFF. Deleting is safe for order history — `OrderItem`
 * snapshots every field it displays and its `variantId` is `SetNull` (spec §5)
 * — but it is irreversible and cascades to cart lines, so it sits one rung
 * above the reversible edits STAFF can make (SEC-7). The editor hides the
 * button for STAFF; this is the check that means it.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/products/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;
  if (guard.user.role !== "ADMIN") {
    return jsonError("FORBIDDEN", "Only an administrator can delete a product.");
  }

  const { id } = await ctx.params;
  const result = await deleteProduct(id);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "product.delete",
    target: id,
    detail: { slug: result.value.slug },
  });

  return jsonOk({ ok: true });
}
