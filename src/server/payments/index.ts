import { serverEnv } from "@/lib/env";
import type { PaymentProviderKind } from "@/generated/prisma/enums";
import type { PaymentProvider } from "@/server/payments/provider";
import { easypaisaProvider } from "@/server/payments/easypaisa";
import { fakeProvider } from "@/server/payments/fake";
import { stripeProvider } from "@/server/payments/stripe";

/**
 * Provider registry.
 *
 * One configured provider takes new checkouts, but *every* provider stays
 * resolvable by kind: an order paid through Easypaisa must still be refundable
 * after the store switches to Stripe, and its webhook must keep working while
 * in-flight payments settle. Routing refunds and callbacks through
 * `providerFor(order.provider)` rather than the configured default is what
 * makes a provider switch safe mid-flight.
 */

const PROVIDERS: Record<PaymentProviderKind, PaymentProvider> = {
  EASYPAISA: easypaisaProvider,
  STRIPE: stripeProvider,
  FAKE: fakeProvider,
};

const KIND_BY_SETTING = {
  easypaisa: "EASYPAISA",
  stripe: "STRIPE",
  fake: "FAKE",
} as const satisfies Record<string, PaymentProviderKind>;

/** The provider new checkouts are routed to. */
export function activeProviderKind(): PaymentProviderKind {
  return KIND_BY_SETTING[serverEnv().PAYMENT_PROVIDER];
}

export function activeProvider(): PaymentProvider {
  return PROVIDERS[activeProviderKind()];
}

/** The provider a given order was actually created with. */
export function providerFor(kind: PaymentProviderKind | null): PaymentProvider {
  return PROVIDERS[kind ?? activeProviderKind()];
}

export type { PaymentProvider } from "@/server/payments/provider";
