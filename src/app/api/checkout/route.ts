import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiVerifiedUser } from "@/lib/auth/api-guard";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { checkoutSchema, idempotencyKeySchema } from "@/lib/validation/checkout";
import { readCartOwner } from "@/server/cart/owner";
import { startCheckout, type CheckoutFailure } from "@/server/orders/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout
 *
 * Creates a PENDING order and returns where to send the browser to pay. It
 * does not take money and it does not touch stock — see the ordering argument
 * in `server/orders/checkout.ts` (SEC-19).
 *
 * Requires a **verified** email address (F1 DoD): an unverifiable buyer cannot
 * receive an order confirmation or a refund notice, which makes every failure
 * mode downstream unresolvable.
 *
 * The `Idempotency-Key` header is what makes a double-click safe (SEC-20). It
 * is a header rather than a body field because it identifies the *attempt*,
 * not the order — a retry of the same attempt must carry the same key even if
 * the body is rebuilt.
 */
const IDEMPOTENCY_HEADER = "idempotency-key";

const FAILURE_STATUS: Record<
  CheckoutFailure,
  "UNPROCESSABLE" | "CONFLICT" | "NOT_FOUND"
> = {
  EMPTY_CART: "UNPROCESSABLE",
  CART_UNAVAILABLE: "CONFLICT",
  ADDRESS_NOT_FOUND: "NOT_FOUND",
  SHIPPING_UNAVAILABLE: "UNPROCESSABLE",
  IN_PROGRESS: "CONFLICT",
  PROVIDER_ERROR: "CONFLICT",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiVerifiedUser();
  if (!guard.ok) return guard.response;

  // Keyed by user, not IP: the limit exists to bound order-creation abuse from
  // one account, and NAT would otherwise make one office share a budget.
  const limited = await rateLimit("checkout", `user:${guard.user.id}`);
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again shortly.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const key = idempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_HEADER));
  if (!key.success) {
    return jsonError("BAD_REQUEST", "A valid Idempotency-Key header is required.");
  }

  const parsed = await parseBody(request, checkoutSchema);
  if (!parsed.ok) return parsed.response;

  const owner = await readCartOwner();
  if (!owner) return jsonError("UNPROCESSABLE", "Your cart is empty.");

  const result = await startCheckout({
    userId: guard.user.id,
    email: guard.user.email,
    // Signed in, so the cart is the user's own. Anything a guest identity
    // still holds was merged at login and is not consulted here.
    owner: { kind: "user", userId: guard.user.id },
    addressId: parsed.data.addressId,
    shippingRateId: parsed.data.shippingRateId,
    idempotencyKey: key.data,
  });

  if (!result.ok) {
    return jsonError(FAILURE_STATUS[result.reason], result.message);
  }

  // `redirect` is where to send the browser: a URL to follow, or a form to
  // post. The client does no more than obey it — it never learns an amount it
  // could alter, because the amount lives on the order (SEC-4).
  return jsonOk({
    orderNumber: result.orderNumber,
    grandTotal: result.grandTotal,
    currency: result.currency,
    redirect: result.redirect,
    replayed: result.replayed,
  });
}
