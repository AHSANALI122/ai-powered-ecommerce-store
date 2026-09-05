import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { removeFromWishlist } from "@/server/wishlist/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/wishlist/[productId] — remove a product from the caller's list.
 *
 * The delete is a `deleteMany` filtered by `{ userId, productId }`, so a
 * product on somebody else's list matches nothing and reports the same 404 as
 * one that was never saved (SEC-23).
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/wishlist/[productId]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { productId } = await ctx.params;
  const removed = await removeFromWishlist(guard.user.id, productId);
  if (!removed) return jsonError("NOT_FOUND", "Not on your wishlist.");

  return jsonOk({ ok: true });
}
