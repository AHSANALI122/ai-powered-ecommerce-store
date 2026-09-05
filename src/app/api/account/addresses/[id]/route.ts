import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { addressUpdateSchema } from "@/lib/validation/address";
import { deleteAddress, updateAddress } from "@/server/addresses/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH / DELETE /api/account/addresses/[id]
 *
 * `updateAddress` and `deleteAddress` both filter on `{ id, userId }`, so an
 * id belonging to another account is indistinguishable from one that does not
 * exist (SEC-23) — which is exactly what the 404 below says.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/account/addresses/[id]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, addressUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateAddress(guard.user.id, id, parsed.data);
  if (!result.ok) return jsonError("NOT_FOUND", "Address not found.");

  return jsonOk({ address: result.address });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/account/addresses/[id]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const removed = await deleteAddress(guard.user.id, id);
  if (!removed) return jsonError("NOT_FOUND", "Address not found.");

  return jsonOk({ ok: true });
}
