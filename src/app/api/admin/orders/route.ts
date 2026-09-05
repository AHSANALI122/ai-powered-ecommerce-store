import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseSearchParams } from "@/lib/http";
import { requireAdminRead } from "@/server/admin/guard";
import { orderListSchema } from "@/lib/validation/admin/operations";
import { listAdminOrders } from "@/server/admin/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orders
 *
 * The one listing in the application that crosses users, which is why the page
 * cap in `adminListSchema` matters more here than anywhere else: without it a
 * single request exports the order book.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const parsed = parseSearchParams(request.nextUrl.searchParams, orderListSchema);
  if (!parsed.ok) return parsed.response;

  return jsonOk(await listAdminOrders(parsed.data));
}
