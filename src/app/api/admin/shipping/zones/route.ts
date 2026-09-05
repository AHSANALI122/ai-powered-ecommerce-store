import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { shippingZoneCreateSchema } from "@/lib/validation/admin/operations";
import { createShippingZone, listShippingZones } from "@/server/admin/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET / POST /api/admin/shipping/zones — zones with their rates nested. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  return jsonOk(await listShippingZones());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, shippingZoneCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createShippingZone(parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "shipping.zone.create",
    target: result.value.id,
    detail: { name: parsed.data.name, countries: parsed.data.countries.length },
  });

  return jsonOk({ zone: result.value }, { status: 201 });
}
