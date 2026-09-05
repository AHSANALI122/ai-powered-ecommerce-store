import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { variantCreateSchema } from "@/lib/validation/admin/catalog";
import { createVariant } from "@/server/admin/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/products/[id]/variants
 *
 * The product id comes from the path, not the body, so a variant cannot be
 * attached to a product the request did not name.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/products/[id]/variants">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, variantCreateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await createVariant(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "variant.create",
    target: result.value.id,
    detail: { productId: id, sku: result.value.sku, stock: result.value.stock },
  });

  return jsonOk({ variant: result.value }, { status: 201 });
}
