/**
 * Payment state is shown alongside fulfilment state rather than folded into
 * one label: "processing but unpaid" and "processing and paid" are different
 * situations for a customer, and collapsing them hides the one they would ask
 * about. An unpaid order therefore shows its *payment* state — which is the
 * thing that is actually blocking it.
 */
export function OrderStatusBadge({
  status,
  paymentStatus,
}: {
  status: string;
  paymentStatus: string;
}) {
  const tone =
    paymentStatus === "PAID"
      ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-500"
      : paymentStatus === "REFUNDED"
        ? "border-amber-500/50 text-amber-700 dark:text-amber-500"
        : paymentStatus === "FAILED"
          ? "border-red-600/40 text-red-700 dark:text-red-400"
          : "border-[var(--color-line)] text-[var(--color-muted)]";

  return (
    <span
      className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${tone}`}
    >
      {paymentStatus === "PAID" ? status.toLowerCase() : paymentStatus.toLowerCase()}
    </span>
  );
}
