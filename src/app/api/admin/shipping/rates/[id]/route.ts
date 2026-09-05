import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { shippingRateUpdateSchema } from "@/lib/validation/admin/operations";
import { deleteShippingRate, updateShippingRate } from "@/server/admin/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH / DELETE /api/admin/shipping/rates/[id]
 *
 * `zoneId` is omitted from the update schema: moving a rate between zones would
 * silently change which destinations it applies to, which is a new rate rather
 * than an edit.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/shipping/rates/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, shippingRateUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateShippingRate(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.rate.update",
    target: id,
    detail: { fields: Object.keys(parsed.data) },
  });

  return jsonOk({ rate: result.value });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/shipping/rates/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await deleteShippingRate(id);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.rate.delete",
    target: id,
    detail: { name: result.value.name },
  });

  return jsonOk({ ok: true });
}
