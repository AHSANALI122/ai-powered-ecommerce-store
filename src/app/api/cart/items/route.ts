import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { guestCookie } from "@/lib/auth/cookies";
import { addCartItemSchema } from "@/lib/validation/cart";
import { resolveCartOwner } from "@/server/cart/owner";
import { addItem } from "@/server/cart/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cart/items — add a variant to the caller's cart.
 *
 * The body names a variant and a quantity and nothing else: the schema is
 * `.strict()` and has no price field, so there is no amount to tamper with
 * (SEC-4, SEC-16). Signing in is not required — a guest cart is keyed to the
 * httpOnly `guestId` cookie, which is minted here when the visitor does not
 * have one yet.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const parsed = await parseBody(request, addCartItemSchema);
  if (!parsed.ok) return parsed.response;

  const { owner, issuedGuestId } = await resolveCartOwner();
  const result = await addItem(owner, parsed.data.variantId, parsed.data.quantity);

  if (!result.ok) {
    // One message for "no such variant" and "not for sale": a probe should not
    // be able to enumerate the catalogue's unpublished rows (SEC-26).
    const message =
      result.reason === "OUT_OF_STOCK"
        ? "That size and colour is sold out."
        : "That item is not available.";
    return jsonError(result.reason === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", message);
  }

  const response = jsonOk({ cart: result.cart });
  if (issuedGuestId) response.cookies.set(guestCookie(issuedGuestId));
  return response;
}
