"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, FormNotice } from "@/components/ui/form";
import { Button } from "@/components/admin/ui";

/**
 * Status transitions.
 *
 * The buttons offered come from `allowedTransitions`, computed server-side from
 * the order's current status — so the UI cannot present a move the service will
 * reject, and, more importantly, cannot be edited into performing one. The
 * service re-derives the same set on submit; this list is a rendering of the
 * rule, not the rule.
 *
 * Refunding says what it does before it does it. It restores the stock the
 * capture decremented and, where the provider has no refund API, records the
 * obligation for a human rather than pretending the money moved.
 */

const DESCRIPTIONS: Record<string, string> = {
  SHIPPED: "Marks the order dispatched and queues the shipping email.",
  DELIVERED: "Marks the order delivered and queues the delivery email.",
  CANCELLED: "Cancels an unpaid order. No stock was held, so nothing is released.",
  REFUNDED:
    "Reverses the charge where the provider supports it, restores the stock this order took, and emails the customer.",
};

export function OrderActions({
  orderNumber,
  status,
  paymentStatus,
  allowedTransitions,
}: {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  allowedTransitions: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function move(target: string) {
    setError(null);
    setNotice(null);
    setArmed(null);

    startTransition(async () => {
      const result = await apiFetch<{ outcome: string }>(
        `/api/admin/orders/${orderNumber}`,
        { method: "PATCH", body: JSON.stringify({ status: target }) },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNotice(
        result.data.outcome === "REFUND_REQUIRES_MANUAL_ACTION"
          ? "Marked refunded and stock restored, but the provider could not reverse the charge automatically — complete the refund in the provider's portal."
          : `Order is now ${target.toLowerCase()}.`,
      );
      router.refresh();
    });
  }

  if (allowedTransitions.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] p-4 text-sm">
        <h3 className="font-medium">No actions available</h3>
        <p className="mt-1 text-[var(--color-muted)]">
          {status === "PENDING"
            ? "This order is waiting on payment. It becomes processable only when the provider confirms the charge, and expires on its own if that never happens."
            : `${status.toLowerCase()} is a final state.`}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] p-4">
      <h3 className="text-sm font-medium">Move this order</h3>
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      <ul className="flex flex-col gap-3">
        {allowedTransitions.map((target) => (
          <li key={target} className="flex flex-wrap items-center gap-3">
            {armed === target ? (
              <>
                <Button tone="danger" disabled={pending} onClick={() => move(target)}>
                  Confirm: {target.toLowerCase()}
                </Button>
                <Button disabled={pending} onClick={() => setArmed(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                tone={target === "REFUNDED" ? "danger" : "primary"}
                disabled={pending}
                onClick={() =>
                  target === "REFUNDED" || target === "CANCELLED"
                    ? setArmed(target)
                    : move(target)
                }
              >
                Mark {target.toLowerCase()}
              </Button>
            )}
            <span className="text-xs text-[var(--color-muted)]">
              {DESCRIPTIONS[target] ?? ""}
            </span>
          </li>
        ))}
      </ul>

      {paymentStatus !== "PAID" ? (
        <p className="text-xs text-[var(--color-muted)]">
          Payment status is {paymentStatus.toLowerCase()}. PAID is set only by a verified
          provider callback — there is no way to set it from here.
        </p>
      ) : null}
    </section>
  );
}
