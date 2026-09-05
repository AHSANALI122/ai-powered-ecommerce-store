import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { moveToCartSchema } from "@/lib/validation/wishlist";
import { moveToCart } from "@/server/wishlist/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wishlist/move-to-cart
 *
 * Its own route rather than a `?action=` on the collection: it writes to two
 * resources, and the body it accepts (a variant and a quantity) is not the
 * body the collection accepts. The service resolves the variant against the
 * wishlisted product and re-checks stock through the ordinary `addItem` path,
 * so nothing here can add an item the cart endpoint would have refused.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, moveToCartSchema);
  if (!parsed.ok) return parsed.response;

  const result = await moveToCart(guard.user.id, parsed.data);
  if (!result.ok) {
    const message =
      result.reason === "OUT_OF_STOCK"
        ? "That product is sold out."
        : "That item is not available.";
    return jsonError(result.reason === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", message);
  }

  return jsonOk({ cart: result.cart });
}
