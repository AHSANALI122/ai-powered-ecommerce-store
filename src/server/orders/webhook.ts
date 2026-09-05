import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentProviderKind } from "@/generated/prisma/enums";
import { providerFor } from "@/server/payments";
import { captureOrder, failOrder } from "@/server/orders/capture";

/**
 * The shared payment-callback pipeline (SEC-6, SEC-19).
 *
 * Every provider's webhook route is a three-line wrapper around this, so the
 * order of checks cannot drift between them:
 *
 *   verify signature → dedupe the event → capture (which re-verifies by
 *   inquiry) → acknowledge.
 *
 * Two rules about the response, both of which matter operationally:
 *
 *  - **An unverified message gets 400 and changes nothing.** This is the only
 *    unauthenticated entry point in the app, and the signature is the whole
 *    authentication (the proxy exempts `/api/webhooks/` from CSRF for exactly
 *    this reason).
 *  - **A verified message we could not act on still gets 200** once it has
 *    been recorded. Providers retry non-2xx until they give up; retrying will
 *    not make a stale event actionable, and the `WebhookEvent` row is the
 *    record that it arrived.
 */

export interface WebhookOutcome {
  status: number;
  body: { received: boolean; outcome?: string };
}

const ACK: WebhookOutcome = { status: 200, body: { received: true } };

function ack(outcome: string): WebhookOutcome {
  return { status: 200, body: { received: true, outcome } };
}

export async function handleProviderCallback(
  kind: PaymentProviderKind,
  request: Request,
  body: string,
): Promise<WebhookOutcome> {
  const provider = providerFor(kind);
  const verification = await provider.verifyCallback(request, body);

  if (!verification.verified) {
    // No detail in the response: an attacker probing the endpoint learns only
    // that it rejected them (SEC-26).
    console.warn(`[webhook:${kind}] rejected an unverified callback`);
    return { status: 400, body: { received: false } };
  }

  // --- Replay protection (§10 #23, SEC-19) --------------------------------
  // The unique (provider, eventId) constraint is the dedupe: a redelivered
  // event loses the insert and returns here without touching stock. The
  // conditional update inside capture is the second, independent guard.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: kind,
        eventId: verification.eventId,
        payload: (verification.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return ack("duplicate");
    }
    throw error;
  }

  if (!verification.orderNumber) {
    await markProcessed(kind, verification.eventId);
    return ack("no-order");
  }

  if (verification.claimedState === "FAILED") {
    await failOrder(verification.orderNumber);
    await markProcessed(kind, verification.eventId);
    return ack("failed");
  }

  if (verification.claimedState !== "PAID") {
    await markProcessed(kind, verification.eventId);
    return ACK;
  }

  // The claim is only a claim. captureOrder asks the provider directly and
  // compares the amount before anything is marked paid (AD-8).
  const result = await captureOrder({
    orderNumber: verification.orderNumber,
    providerRef: verification.providerRef,
  });

  await markProcessed(kind, verification.eventId);
  return ack(result.outcome);
}

async function markProcessed(kind: PaymentProviderKind, eventId: string): Promise<void> {
  await prisma.webhookEvent.updateMany({
    where: { provider: kind, eventId },
    data: { processedAt: new Date() },
  });
}
