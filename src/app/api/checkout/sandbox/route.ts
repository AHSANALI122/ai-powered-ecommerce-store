import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { idSchema } from "@/lib/validation/cart";
import { recordSandboxPayment, sandboxCallbackBody } from "@/server/payments/fake";
import { handleProviderCallback } from "@/server/orders/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/sandbox — "the sandbox provider's own backend"
 * (development only).
 *
 * The sandbox page calls this to say what the fake payment did. This endpoint
 * then behaves exactly as a provider would: it records the outcome in its own
 * ledger, and *separately* delivers a signed callback into the real webhook
 * pipeline. Splitting those two steps is the whole point — the callback alone
 * cannot mark an order paid, because capture independently inquires against
 * the ledger before it believes anything (AD-8).
 *
 * Deliberately requires the caller to own the order even though it is
 * development-only: a sandbox that lets any signed-in user settle any order
 * would train the wrong reflexes into every test written against it.
 */
const sandboxSchema = z
  .object({
    orderNumber: idSchema,
    outcome: z.enum(["paid", "failed"]),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (serverEnv().NODE_ENV === "production") {
    return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, sandboxSchema);
  if (!parsed.ok) return parsed.response;

  const order = await prisma.order.findFirst({
    where: { orderNumber: parsed.data.orderNumber, userId: guard.user.id },
    select: {
      id: true,
      orderNumber: true,
      email: true,
      currency: true,
      grandTotal: true,
      expiresAt: true,
      providerRef: true,
      provider: true,
    },
  });
  if (!order) return jsonError("NOT_FOUND", "Order not found.");
  if (order.provider !== "FAKE") {
    return jsonError("CONFLICT", "That order was not created with the sandbox provider.");
  }

  await recordSandboxPayment(
    {
      id: order.id,
      orderNumber: order.orderNumber,
      email: order.email,
      currency: order.currency,
      grandTotal: order.grandTotal.toString(),
      expiresAt: order.expiresAt,
      providerRef: order.providerRef,
    },
    parsed.data.outcome === "paid" ? "PAID" : "FAILED",
  );

  const result = await handleProviderCallback(
    "FAKE",
    request,
    sandboxCallbackBody(order.orderNumber, parsed.data.outcome),
  );

  return jsonOk({ orderNumber: order.orderNumber, ...result.body });
}
