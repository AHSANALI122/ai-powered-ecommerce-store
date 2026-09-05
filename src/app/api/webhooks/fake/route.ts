import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { handleProviderCallback } from "@/server/orders/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/fake — the sandbox provider's IPN (development only).
 *
 * It exists so the *whole* capture path, webhook route included, can be
 * exercised without Easypaisa credentials: an HMAC-signed body verified the
 * same way a real hash is, then the same inquiry-and-capture pipeline.
 *
 * The 404 below is not decoration. `env.ts` already refuses to boot with
 * PAYMENT_PROVIDER="fake" in production, and this makes the route itself
 * disappear there too — a development affordance that can mark orders paid
 * should not merely be unreachable in production, it should not exist.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (serverEnv().NODE_ENV === "production") {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const body = await request.text();
  const result = await handleProviderCallback("FAKE", request, body);
  return NextResponse.json(result.body, { status: result.status });
}
