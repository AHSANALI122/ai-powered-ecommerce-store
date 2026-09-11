import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiCheckoutUser } from "@/lib/auth/api-guard";
import { quoteRequestSchema } from "@/lib/validation/checkout";
import { readCartOwner } from "@/server/cart/owner";
import { getCartView } from "@/server/cart/service";
import { buildQuote } from "@/server/pricing/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/quote
 *
 * Prices the current cart against a chosen address so the checkout screen can
 * show shipping and tax before payment. It is the *same* `buildQuote` the
 * checkout endpoint runs, which is the point: the figure a shopper agrees to
 * and the figure sent to the provider come from one code path, so they cannot
 * drift (SEC-4, SEC-11).
 *
 * A quote is not a promise. Nothing is reserved, nothing is written, and the
 * totals are recomputed from scratch at checkout.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiCheckoutUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, quoteRequestSchema);
  if (!parsed.ok) return parsed.response;

  const cart = await getCartView(await readCartOwner());
  if (cart.lines.length === 0) {
    return jsonError("UNPROCESSABLE", "Your cart is empty.");
  }

  const address = await prisma.address.findFirst({
    where: { id: parsed.data.addressId, userId: guard.user.id },
    select: { country: true },
  });
  if (!address) return jsonError("NOT_FOUND", "Address not found.");

  const quote = await buildQuote({
    lines: cart.lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
    })),
    country: address.country,
    shippingRateId: parsed.data.shippingRateId,
  });

  return jsonOk({ quote, cart });
}
