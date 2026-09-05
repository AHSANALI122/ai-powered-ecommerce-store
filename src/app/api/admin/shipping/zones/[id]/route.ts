import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { shippingZoneUpdateSchema } from "@/lib/validation/admin/operations";
import { deleteShippingZone, updateShippingZone } from "@/server/admin/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH / DELETE /api/admin/shipping/zones/[id] */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/shipping/zones/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, shippingZoneUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateShippingZone(id, parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.zone.update",
    target: id,
    detail: { fields: Object.keys(parsed.data) },
  });

  return jsonOk({ ok: true });
}

/** Rates cascade with the zone, so this removes the zone's rates too. */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/shipping/zones/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const result = await deleteShippingZone(id);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.zone.delete",
    target: id,
    detail: { name: result.value.name },
  });

  return jsonOk({ ok: true });
}
