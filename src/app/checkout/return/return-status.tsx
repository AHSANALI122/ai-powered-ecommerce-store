"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { useCartStore } from "@/stores/cart";

/**
 * Polls the order's own status while a payment settles.
 *
 * The provider's callback travels server-to-server, so it can land before or
 * after the shopper's browser gets back here. Polling our own API — not
 * reading a query parameter — is what keeps the redirect out of the trust
 * chain (§10 #33).
 *
 * Polling stops as soon as the status is terminal, and gives up after a bounded
 * number of attempts rather than hammering the endpoint forever on a tab left
 * open.
 */

type Status =
  | "PENDING"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED";
type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 24; // ~1 minute

export function ReturnStatus({
  orderNumber,
  initialStatus,
  initialPaymentStatus,
}: {
  orderNumber: string;
  initialStatus: Status;
  initialPaymentStatus: PaymentStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [paymentStatus, setPaymentStatus] = useState(initialPaymentStatus);
  const [attempts, setAttempts] = useState(0);
  const resetCart = useCartStore((state) => state.reset);

  const settled = paymentStatus !== "PENDING";

  useEffect(() => {
    if (settled || attempts >= MAX_POLLS) return;

    const timer = setTimeout(() => {
      void (async () => {
        const result = await apiFetch<{ status: Status; paymentStatus: PaymentStatus }>(
          `/api/orders/${encodeURIComponent(orderNumber)}`,
        );
        if (result.ok) {
          setStatus(result.data.status);
          setPaymentStatus(result.data.paymentStatus);
        }
        setAttempts((count) => count + 1);
      })();
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [orderNumber, attempts, settled]);

  // The capture transaction emptied the bought lines from the cart; tell the
  // header badge to re-read rather than keep showing a stale count.
  useEffect(() => {
    if (paymentStatus === "PAID") resetCart();
  }, [paymentStatus, resetCart]);

  if (paymentStatus === "PAID") {
    return (
      <Panel tone="ok" title="Payment confirmed">
        Your order is {status.toLowerCase()}. A confirmation email is on its way.
      </Panel>
    );
  }

  if (paymentStatus === "REFUNDED") {
    return (
      <Panel tone="warn" title="Refunded">
        The payment went through, but an item sold out before we could allocate it. The
        charge has been reversed and you will receive a confirmation of the refund.
      </Panel>
    );
  }

  if (paymentStatus === "FAILED" || status === "EXPIRED" || status === "CANCELLED") {
    return (
      <Panel tone="warn" title="Payment not completed">
        Nothing has been charged and nothing was reserved. You can place the order again
        from your cart.
      </Panel>
    );
  }

  if (attempts >= MAX_POLLS) {
    return (
      <Panel tone="muted" title="Still waiting on the payment provider">
        We have not had a confirmed result yet. This page is safe to leave — the order
        updates on its own, and you can check it from your orders list.
      </Panel>
    );
  }

  return (
    <Panel tone="muted" title="Confirming your payment">
      Waiting for the payment provider to confirm. This usually takes a few seconds.
    </Panel>
  );
}

function Panel({
  tone,
  title,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  title: string;
  children: React.ReactNode;
}) {
  const border =
    tone === "ok"
      ? "border-emerald-600/40 bg-emerald-600/5"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-[var(--color-line)]";

  return (
    <div role="status" aria-live="polite" className={`rounded-lg border p-6 ${border}`}>
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{children}</p>
    </div>
  );
}
