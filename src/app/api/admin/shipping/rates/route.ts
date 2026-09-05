import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { shippingRateCreateSchema } from "@/lib/validation/admin/operations";
import { createShippingRate } from "@/server/admin/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/shipping/rates — the zone is named in the body. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, shippingRateCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createShippingRate(parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.rate.create",
    target: result.value.id,
    detail: { zoneId: parsed.data.zoneId, price: result.value.price },
  });

  return jsonOk({ rate: result.value }, { status: 201 });
}
