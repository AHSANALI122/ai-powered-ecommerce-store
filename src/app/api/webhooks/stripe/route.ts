import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleProviderCallback } from "@/server/orders/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe (AD-8, SEC-6).
 *
 * `request.text()` rather than `request.json()` is load-bearing: Stripe's
 * signature covers the exact bytes it sent, and re-serialising a parsed object
 * changes key order and whitespace enough to invalidate it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const result = await handleProviderCallback("STRIPE", request, body);
  return NextResponse.json(result.body, { status: result.status });
}
