import { NextResponse } from "next/server";
import { jsonOk } from "@/lib/http";
import { readCartOwner } from "@/server/cart/owner";
import { getCartView } from "@/server/cart/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cart
 *
 * The cart the *caller* owns, resolved from the session cookie or the guest
 * cookie — there is no cart id in the URL to point somewhere else (SEC-23).
 * Prices in the response are read from the database on every call, so a cart
 * left open overnight shows tonight's prices, not last night's (SEC-11).
 */
export async function GET(): Promise<NextResponse> {
  return jsonOk({ cart: await getCartView(await readCartOwner()) });
}
