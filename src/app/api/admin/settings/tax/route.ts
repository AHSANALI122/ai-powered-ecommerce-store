import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { adminLog } from "@/server/admin/audit";
import { taxRateUpdateSchema } from "@/lib/validation/admin/operations";
import { readTaxRateSetting, writeTaxRateSetting } from "@/server/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / PATCH /api/admin/settings/tax
 *
 * ADMIN only, not STAFF. Everything else in the dashboard is reversible and
 * scoped to one row; the tax rate silently changes what every future shopper is
 * charged, which is a different class of authority (SEC-7).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  return jsonOk({ tax: await readTaxRateSetting() });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;
  if (guard.user.role !== "ADMIN") {
    return jsonError("FORBIDDEN", "Only an administrator can change the tax rate.");
  }

  const parsed = await parseBody(request, taxRateUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const before = await readTaxRateSetting();
  const tax = await writeTaxRateSetting(parsed.data.rate);

  adminLog(guard.user, {
    action: "settings.update",
    target: "tax.rate",
    detail: { from: before.rate, to: tax.rate },
  });

  return jsonOk({ tax });
}
