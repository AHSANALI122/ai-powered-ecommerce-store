import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { orderStatusUpdateSchema } from "@/lib/validation/admin/operations";
import { getAdminOrder, transitionOrder } from "@/server/admin/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET / PATCH /api/admin/orders/[orderNumber] */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/admin/orders/[orderNumber]">,
): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const { orderNumber } = await ctx.params;
  const order = await getAdminOrder(orderNumber);
  if (!order) return jsonError("NOT_FOUND", "Order not found.");

  return jsonOk({ order });
}

/**
 * The only write an operator has on an order: a status transition, checked
 * against the state machine in `transitionOrder` and logged with its actor.
 *
 * There is no field here for `paymentStatus`, `paidAt` or any total. PAID is
 * set by `captureOrder` behind a verified provider signal and a
 * transaction-inquiry, and by nothing else (SEC-6, AD-8) — so the dashboard
 * simply has no vocabulary for asserting that money arrived.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/orders/[orderNumber]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, orderStatusUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { orderNumber } = await ctx.params;
  const result = await transitionOrder({ orderNumber, target: parsed.data.status });
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "order.status",
    target: orderNumber,
    detail: {
      status: result.value.status,
      outcome: result.value.outcome,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    },
  });

  const order = await getAdminOrder(orderNumber);
  return jsonOk({ order, outcome: result.value.outcome });
}
