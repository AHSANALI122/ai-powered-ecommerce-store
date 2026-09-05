import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { toStorage } from "@/lib/money";
import {
  PaymentProviderError,
  type CallbackVerification,
  type CreatePaymentResult,
  type InquiryResult,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentState,
  type RefundResult,
} from "@/server/payments/provider";

/**
 * A local stand-in for a real payment provider (development only).
 *
 * Easypaisa sandbox credentials are still an open item (spec §9), and the
 * lifecycle they gate — PENDING → verified callback → inquiry → atomic stock
 * decrement → PAID, with auto-refund when stock vanished — is the part of F3
 * most worth testing. So this provider implements the same interface with the
 * same two-step trust model:
 *
 *  - the callback is **HMAC-signed** with `AUTH_SECRET` and verified the same
 *    way a real hash or signature is, so an unsigned POST to the webhook can
 *    no more mark an order paid here than it could in production;
 *  - `inquire` reads a **separate ledger** written by the sandbox's own
 *    endpoint, so a forged callback still cannot conjure a settled payment.
 *
 * Its ledger lives in the `Setting` table rather than a module-level Map,
 * because a Map is a silent no-op the moment there is more than one instance
 * (SEC-18) and dev habits become production bugs. `env.ts` refuses to boot
 * with PAYMENT_PROVIDER="fake" in production.
 */

export type SandboxOutcome = "paid" | "failed";

const LEDGER_PREFIX = "fake.payment.";

function ledgerKey(orderNumber: string): string {
  return `${LEDGER_PREFIX}${orderNumber}`;
}

function signingKey(): string {
  const secret = serverEnv().AUTH_SECRET;
  if (!secret) {
    throw new PaymentProviderError(
      "AUTH_SECRET is required to sign sandbox payments.",
      "FAKE",
    );
  }
  return secret;
}

/** Signs `orderNumber.outcome`, exactly as a provider signs its callback. */
export function signSandboxOutcome(orderNumber: string, outcome: SandboxOutcome): string {
  return createHmac("sha256", signingKey())
    .update(`${orderNumber}.${outcome}`, "utf8")
    .digest("hex");
}

export function verifySandboxSignature(
  orderNumber: string,
  outcome: SandboxOutcome,
  signature: string,
): boolean {
  const expected = Buffer.from(signSandboxOutcome(orderNumber, outcome), "utf8");
  const presented = Buffer.from(signature, "utf8");
  if (expected.length !== presented.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, presented);
}

interface LedgerEntry {
  state: PaymentState;
  amount: string;
  currency: string;
  /** Prisma's Json input type requires an index signature. */
  [key: string]: string;
}

function readLedgerEntry(value: unknown): LedgerEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (state !== "PAID" && state !== "PENDING" && state !== "FAILED") return null;
  return {
    state,
    amount: typeof record.amount === "string" ? record.amount : "0.00",
    currency: typeof record.currency === "string" ? record.currency : "PKR",
  };
}

/** Called by the sandbox endpoint — "the provider" recording what happened. */
export async function recordSandboxPayment(
  order: PaymentOrder,
  state: PaymentState,
): Promise<void> {
  const entry: LedgerEntry = {
    state,
    amount: toStorage(order.grandTotal),
    currency: order.currency,
  };
  await prisma.setting.upsert({
    where: { key: ledgerKey(order.orderNumber) },
    create: { key: ledgerKey(order.orderNumber), value: entry },
    update: { value: entry },
  });
}

/** Body shape the fake webhook accepts, mirroring an IPN form post. */
export interface SandboxCallbackBody {
  orderNumber: string;
  outcome: SandboxOutcome;
  signature: string;
}

export function sandboxCallbackBody(
  orderNumber: string,
  outcome: SandboxOutcome,
): string {
  return JSON.stringify({
    orderNumber,
    outcome,
    signature: signSandboxOutcome(orderNumber, outcome),
  } satisfies SandboxCallbackBody);
}

export const fakeProvider: PaymentProvider = {
  kind: "FAKE",
  label: "Sandbox (development)",

  async createPayment(order: PaymentOrder): Promise<CreatePaymentResult> {
    await recordSandboxPayment(order, "PENDING");
    return {
      providerRef: `fake_${order.orderNumber}`,
      redirect: {
        method: "GET",
        url: new URL(
          `/checkout/sandbox/${encodeURIComponent(order.orderNumber)}`,
          serverEnv().APP_URL,
        ).toString(),
      },
    };
  },

  async verifyCallback(_request: Request, body: string): Promise<CallbackVerification> {
    let parsed: Partial<SandboxCallbackBody> = {};
    try {
      parsed = JSON.parse(body) as Partial<SandboxCallbackBody>;
    } catch {
      /* an unparseable body simply fails verification below */
    }

    const orderNumber =
      typeof parsed.orderNumber === "string" ? parsed.orderNumber : null;
    const outcome =
      parsed.outcome === "paid" || parsed.outcome === "failed" ? parsed.outcome : null;
    const signature = typeof parsed.signature === "string" ? parsed.signature : null;

    const verified = Boolean(
      orderNumber &&
      outcome &&
      signature &&
      verifySandboxSignature(orderNumber, outcome, signature),
    );

    return {
      verified,
      eventId: `${orderNumber ?? "unknown"}:${outcome ?? "none"}`,
      orderNumber,
      providerRef: orderNumber ? `fake_${orderNumber}` : null,
      claimedState: outcome === "paid" ? "PAID" : "FAILED",
      payload: parsed,
    };
  },

  async inquire(order: PaymentOrder): Promise<InquiryResult> {
    const row = await prisma.setting.findUnique({
      where: { key: ledgerKey(order.orderNumber) },
      select: { value: true },
    });

    const entry = readLedgerEntry(row?.value);
    if (!entry) return { state: "PENDING", amount: null, currency: null };

    return { state: entry.state, amount: entry.amount, currency: entry.currency };
  },

  async refund(order: PaymentOrder, amount: string): Promise<RefundResult> {
    await prisma.setting.upsert({
      where: { key: ledgerKey(order.orderNumber) },
      create: {
        key: ledgerKey(order.orderNumber),
        value: { state: "FAILED", amount: toStorage(amount), currency: order.currency },
      },
      update: {
        value: { state: "FAILED", amount: toStorage(amount), currency: order.currency },
      },
    });
    return { refundRef: `fake_refund_${order.orderNumber}`, automatic: true };
  },
};
