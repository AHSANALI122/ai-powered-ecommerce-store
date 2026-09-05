import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { handleProviderCallback } from "@/server/orders/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/easypaisa — the IPN postback (AD-8, SEC-6).
 *
 * Unauthenticated by design and exempt from CSRF in the proxy: Easypaisa
 * carries no cookie and cannot echo a token. Its proof is the hash computed
 * with our `hashKey`, checked in `easypaisaProvider.verifyCallback`, and then
 * — because a hash proves origin, not settlement — a Transaction Inquiry call
 * before the order is touched.
 *
 * The body is read as text once and passed down intact, so a hash computed
 * over the raw bytes stays computable.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const result = await handleProviderCallback("EASYPAISA", request, body);
  return NextResponse.json(result.body, { status: result.status });
}
