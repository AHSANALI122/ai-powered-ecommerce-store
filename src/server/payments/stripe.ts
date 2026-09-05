import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { fromMinorUnits, toMinorUnits, toStorage } from "@/lib/money";
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
 * Stripe Checkout Sessions, over the REST API (AD-8, SEC-6).
 *
 * No SDK: the three calls used here are form-encoded POSTs and the webhook
 * signature is an HMAC, so the dependency would buy nothing and the signature
 * check is clearer written out than trusted to a helper.
 *
 * The trust model matches Easypaisa's even though Stripe's signature is
 * stronger: the signed webhook establishes origin, and the caller still
 * confirms the amount against the order before capture. A signature says
 * "Stripe sent this", not "this is the order you think it is".
 *
 * ---------------------------------------------------------------------------
 * Availability: Stripe is not offered to Pakistan-incorporated merchants and
 * PKR is not a presentment currency on most accounts (CLAUDE.md, "Decisions
 * locked"). This leg is therefore written and gated but not commercially
 * usable until that is resolved — `PAYMENT_PROVIDER=stripe` needs a working
 * account before it can be selected.
 * ---------------------------------------------------------------------------
 */

const API_BASE = "https://api.stripe.com/v1";
/** Reject a webhook whose timestamp is older than this, to bound replay. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

function config() {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    throw new PaymentProviderError(
      "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
      "STRIPE",
    );
  }
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    appUrl: env.APP_URL,
  };
}

async function stripeRequest(
  path: string,
  init: {
    method: "GET" | "POST";
    form?: Record<string, string>;
    idempotencyKey?: string;
  },
): Promise<Record<string, unknown>> {
  const cfg = config();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.secretKey}`,
    "Stripe-Version": "2025-08-27.basil",
  };
  if (init.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
    cache: "no-store",
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    // The provider's message goes to the log, never to the shopper (SEC-26).
    const detail =
      data.error && typeof data.error === "object" && "message" in data.error
        ? String((data.error as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new PaymentProviderError(`Stripe request failed: ${detail}`, "STRIPE");
  }
  return data;
}

/**
 * Stripe signs `${timestamp}.${rawBody}`. The raw bytes matter: re-serialising
 * a parsed object changes key order and whitespace and invalidates the
 * signature, which is why the route reads the body as text exactly once.
 *
 * Exported so the signature scheme is unit-testable without a Stripe account.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (!key || !value) continue;
    if (key.trim() === "t") timestamp = value.trim();
    if (key.trim() === "v1") signatures.push(value.trim());
  }

  if (!timestamp || signatures.length === 0) return false;
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  if (Math.abs(nowSeconds - issuedAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return signatures.some((candidate) => {
    const presented = Buffer.from(candidate, "utf8");
    if (presented.length !== expectedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, presented);
  });
}

function sessionState(session: Record<string, unknown>): PaymentState {
  if (session.payment_status === "paid") return "PAID";
  if (session.status === "expired") return "FAILED";
  return "PENDING";
}

export const stripeProvider: PaymentProvider = {
  kind: "STRIPE",
  label: "Card (Stripe)",

  async createPayment(order: PaymentOrder): Promise<CreatePaymentResult> {
    const cfg = config();
    const currency = order.currency.toLowerCase();

    // One line item for the server-computed grand total. Itemising here would
    // invite a rounding disagreement between our totals and Stripe's sum; the
    // order rows are the itemised record (SEC-4).
    const session = await stripeRequest("/checkout/sessions", {
      method: "POST",
      // Retrying checkout for the same order must not open a second session.
      idempotencyKey: `order_${order.id}`,
      form: {
        mode: "payment",
        client_reference_id: order.orderNumber,
        customer_email: order.email,
        success_url: new URL(
          `/checkout/return?order=${encodeURIComponent(order.orderNumber)}`,
          cfg.appUrl,
        ).toString(),
        cancel_url: new URL(
          `/checkout/return?order=${encodeURIComponent(order.orderNumber)}&cancelled=1`,
          cfg.appUrl,
        ).toString(),
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][unit_amount]": String(toMinorUnits(order.grandTotal)),
        "line_items[0][price_data][product_data][name]": `Order ${order.orderNumber}`,
        "metadata[orderNumber]": order.orderNumber,
        "payment_intent_data[metadata][orderNumber]": order.orderNumber,
      },
    });

    const id = typeof session.id === "string" ? session.id : null;
    const url = typeof session.url === "string" ? session.url : null;
    if (!id || !url) {
      throw new PaymentProviderError("Stripe returned no checkout URL.", "STRIPE");
    }

    return { providerRef: id, redirect: { method: "GET", url } };
  },

  async verifyCallback(request: Request, body: string): Promise<CallbackVerification> {
    const cfg = config();
    const verified = verifyStripeSignature(
      body,
      request.headers.get("stripe-signature"),
      cfg.webhookSecret,
    );

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {
        verified: false,
        eventId: "unparseable",
        orderNumber: null,
        providerRef: null,
        claimedState: "PENDING",
        payload: null,
      };
    }

    const data = event.data as { object?: Record<string, unknown> } | undefined;
    const object = data?.object ?? {};
    const orderNumber =
      typeof object.client_reference_id === "string" ? object.client_reference_id : null;

    // Only the completion events say anything about money. Everything else is
    // acknowledged and ignored.
    const type = typeof event.type === "string" ? event.type : "";
    const claimedState: PaymentState =
      type === "checkout.session.completed" ||
      type === "checkout.session.async_payment_succeeded"
        ? sessionState(object)
        : type === "checkout.session.expired" ||
            type === "checkout.session.async_payment_failed"
          ? "FAILED"
          : "PENDING";

    return {
      verified,
      eventId: typeof event.id === "string" ? event.id : "unknown",
      orderNumber,
      providerRef: typeof object.id === "string" ? object.id : null,
      claimedState,
      payload: { type, id: event.id },
    };
  },

  async inquire(order: PaymentOrder): Promise<InquiryResult> {
    if (!order.providerRef) return { state: "PENDING", amount: null, currency: null };

    const session = await stripeRequest(`/checkout/sessions/${order.providerRef}`, {
      method: "GET",
    });

    const total = session.amount_total;
    return {
      state: sessionState(session),
      amount: typeof total === "number" ? toStorage(fromMinorUnits(total)) : null,
      currency:
        typeof session.currency === "string" ? session.currency.toUpperCase() : null,
    };
  },

  async refund(order: PaymentOrder, amount: string): Promise<RefundResult> {
    if (!order.providerRef) {
      throw new PaymentProviderError("Order has no Stripe session to refund.", "STRIPE");
    }

    const session = await stripeRequest(`/checkout/sessions/${order.providerRef}`, {
      method: "GET",
    });
    const paymentIntent = session.payment_intent;
    if (typeof paymentIntent !== "string") {
      throw new PaymentProviderError("Stripe session has no payment intent.", "STRIPE");
    }

    const refund = await stripeRequest("/refunds", {
      method: "POST",
      idempotencyKey: `refund_${order.id}`,
      form: {
        payment_intent: paymentIntent,
        amount: String(toMinorUnits(amount)),
        reason: "requested_by_customer",
      },
    });

    return {
      refundRef: typeof refund.id === "string" ? refund.id : `refund_${order.id}`,
      automatic: true,
    };
  },
};
