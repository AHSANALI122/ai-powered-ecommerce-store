import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { addWishlistItemSchema } from "@/lib/validation/wishlist";
import { addToWishlist, listWishlist } from "@/server/wishlist/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wishlist — the caller's own list.
 *
 * There is no `?userId=`, and there could not be one: the schema has no such
 * field and the service takes the owner as an argument the handler supplies
 * from the session (SEC-23). Signing in is required — unlike the cart, which
 * serves guests on a cookie — because a list only earns its keep across
 * devices.
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  return jsonOk({ items: await listWishlist(guard.user.id) });
}

/** POST /api/wishlist — add a product. Idempotent; a repeat is not an error. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, addWishlistItemSchema);
  if (!parsed.ok) return parsed.response;

  const result = await addToWishlist(guard.user.id, parsed.data.productId);
  if (!result.ok) {
    return result.reason === "LIMIT"
      ? jsonError("CONFLICT", "Your wishlist is full. Remove something first.")
      : jsonError("NOT_FOUND", "That product is not available.");
  }

  return jsonOk({ added: result.added });
}
