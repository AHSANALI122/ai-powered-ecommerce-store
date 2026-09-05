import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { updateCartItemSchema } from "@/lib/validation/cart";
import { readCartOwner } from "@/server/cart/owner";
import { removeItem, updateItemQuantity } from "@/server/cart/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH / DELETE /api/cart/items/[itemId]
 *
 * The item id in the path is not access control (SEC-23): both handlers scope
 * the write to the caller's own cart, so an id from somebody else's cart
 * matches zero rows and comes back as a 404. There is nothing to compare after
 * the fact and therefore nothing to forget to compare.
 *
 * Mutations against a cart that does not exist yet cannot be legitimate — you
 * cannot edit a line you never added — so an owner-less caller is rejected
 * rather than given a fresh guest identity.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/cart/items/[itemId]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const parsed = await parseBody(request, updateCartItemSchema);
  if (!parsed.ok) return parsed.response;

  const owner = await readCartOwner();
  if (!owner) return jsonError("NOT_FOUND", "Item not found.");

  const { itemId } = await ctx.params;
  const result = await updateItemQuantity(owner, itemId, parsed.data.quantity);
  if (!result.ok) return jsonError("NOT_FOUND", "Item not found.");

  return jsonOk({ cart: result.cart });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/cart/items/[itemId]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const owner = await readCartOwner();
  if (!owner) return jsonError("NOT_FOUND", "Item not found.");

  const { itemId } = await ctx.params;
  const result = await removeItem(owner, itemId);
  if (!result.ok) return jsonError("NOT_FOUND", "Item not found.");

  return jsonOk({ cart: result.cart });
}
