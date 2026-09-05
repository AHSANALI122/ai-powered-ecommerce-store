import type { PaymentProviderKind } from "@/generated/prisma/enums";

/**
 * The payment boundary (AD-8, SEC-6).
 *
 * Every provider is reduced to four operations, and the split between them is
 * the security model rather than a tidiness exercise:
 *
 *  - `createPayment` hands the shopper to the provider. Its return value is a
 *    redirect, nothing more. It never marks anything paid.
 *  - `verifyCallback` proves a message really came from the provider — a
 *    signature or a keyed hash. A browser landing on a success URL is not a
 *    message from the provider and never reaches this (loophole #33).
 *  - `inquire` asks the provider directly what it thinks the payment's status
 *    and amount are. Easypaisa requires this *in addition to* a verified hash,
 *    because a hash proves origin, not settlement.
 *  - `refund` reverses a capture that could not be honoured (SEC-19).
 *
 * Amounts crossing this boundary are canonical decimal strings in the base
 * currency's major units. Conversion to a provider's integer minor units
 * happens inside that provider and nowhere else (AD-6).
 */

export interface PaymentOrder {
  id: string;
  orderNumber: string;
  email: string;
  currency: string;
  /** Server-computed total. The only amount a provider is ever given (SEC-4). */
  grandTotal: string;
  expiresAt: Date | null;
  providerRef: string | null;
}

/** How the browser is handed to the provider once an order exists. */
export type PaymentRedirect =
  | { method: "GET"; url: string }
  | { method: "POST"; url: string; fields: Record<string, string> };

export interface CreatePaymentResult {
  /** The provider's handle for this payment, stored on the order. */
  providerRef: string;
  redirect: PaymentRedirect;
}

/** What a provider says about a payment, normalised. */
export type PaymentState = "PAID" | "PENDING" | "FAILED";

export interface CallbackVerification {
  /**
   * True only when the message's signature or hash checked out. False means
   * "this did not come from the provider" — the request is dropped, and
   * nothing about the order changes.
   */
  verified: boolean;
  /** Stable id for webhook dedupe; joins `WebhookEvent(provider, eventId)`. */
  eventId: string;
  orderNumber: string | null;
  providerRef: string | null;
  /** The status *claimed* by the callback, still to be confirmed by inquiry. */
  claimedState: PaymentState;
  payload: unknown;
}

export interface InquiryResult {
  state: PaymentState;
  /** Major units, as reported by the provider. Null when it did not say. */
  amount: string | null;
  currency: string | null;
  /** Provider-side reference, when the inquiry reveals a better one. */
  providerRef?: string | null;
}

export interface RefundResult {
  refundRef: string;
  /**
   * False when the provider has no refund API and a human must act. The order
   * is still marked REFUNDED and an operator notification is queued, so a
   * capture that could not be honoured never silently keeps the money.
   */
  automatic: boolean;
}

export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  /** Human-readable, shown on the checkout screen. */
  readonly label: string;
  createPayment(order: PaymentOrder): Promise<CreatePaymentResult>;
  /**
   * `body` is the raw request body, read once by the caller: Stripe's
   * signature is computed over the exact bytes, so it cannot be re-derived
   * from a parsed object.
   */
  verifyCallback(request: Request, body: string): Promise<CallbackVerification>;
  inquire(order: PaymentOrder): Promise<InquiryResult>;
  refund(order: PaymentOrder, amount: string): Promise<RefundResult>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly kind: PaymentProviderKind,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
