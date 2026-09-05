"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";
import { Badge } from "@/components/admin/table";
import type { TaxRateView } from "@/server/admin/settings";

/**
 * The flat tax rate.
 *
 * Entered as a decimal fraction, and the screen shows the percentage it works
 * out to as you type. That echo is the point: `18` and `0.18` are one keystroke
 * apart and mean an 1800% tax and an 18% one. The server rejects anything above
 * 1, so the mistake is caught either way — but being told before you submit is
 * better than being told after.
 */
export function TaxRateForm({ tax }: { tax: TaxRateView }) {
  const router = useRouter();
  const [rate, setRate] = useState(tax.rate);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const parsed = Number(rate);
  const percentage =
    Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? `${(parsed * 100).toFixed(2).replace(/\.?0+$/, "")}%`
      : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await apiFetch<{ tax: TaxRateView }>("/api/admin/settings/tax", {
        method: "PATCH",
        body: JSON.stringify({ rate: rate.trim() }),
      });
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      setNotice(
        `Tax rate is now ${result.data.tax.rate}. It applies to every quote from the next request on.`,
      );
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Tax rate</h3>
        {tax.source === "env" ? (
          <Badge>using the TAX_RATE default</Badge>
        ) : (
          <Badge tone="good">
            overridden {tax.updatedAt ? tax.updatedAt.toISOString().slice(0, 10) : ""}
          </Badge>
        )}
      </div>

      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      <div className="max-w-xs">
        <TextField
          label="Rate"
          value={rate}
          inputMode="decimal"
          errors={fieldErrors.rate}
          disabled={pending}
          hint={
            percentage
              ? `That is ${percentage}. The environment default is ${tax.envDefault}.`
              : "Enter a fraction between 0 and 1, e.g. 0.18 for 18%."
          }
          onChange={(event) => setRate(event.target.value)}
        />
      </div>

      <div>
        <SubmitButton pending={pending}>Save tax rate</SubmitButton>
      </div>
    </form>
  );
}
