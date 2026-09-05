import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { requireApiUser } from "@/lib/auth/api-guard";
import { getOrderStatus } from "@/server/orders/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[orderNumber] — payment status, for the return page to poll.
 *
 * This is the honest answer to "did my payment go through?": it reports what
 * the *server* believes, which only a verified provider signal can have
 * changed (SEC-6). The browser arriving back from a hosted checkout proves
 * nothing and is not consulted (§10 #33).
 *
 * Owner-scoped, so a guessed order number returns 404 rather than somebody
 * else's status (SEC-23).
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderNumber]">,
): Promise<NextResponse> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const { orderNumber } = await ctx.params;
  const status = await getOrderStatus(guard.user.id, orderNumber);
  if (!status) return jsonError("NOT_FOUND", "Order not found.");

  return jsonOk({ orderNumber, ...status });
}
