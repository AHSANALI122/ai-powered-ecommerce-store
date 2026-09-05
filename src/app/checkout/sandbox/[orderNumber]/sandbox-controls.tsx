"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";
import { runtimeRoute } from "@/lib/routes";

/**
 * Sandbox outcome buttons (development only).
 *
 * These do not mark the order paid. They tell the sandbox provider what its
 * payment did; the provider then records it and delivers a signed callback
 * through the same webhook pipeline a real provider uses. The browser is then
 * sent to `/checkout/return`, which — exactly as in production — learns the
 * result by asking the server, not by having been redirected.
 */
export function SandboxControls({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(outcome: "paid" | "failed") {
    setError(null);
    startTransition(async () => {
      const result = await postJson<{ outcome?: string }>("/api/checkout/sandbox", {
        orderNumber,
        outcome,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(
        runtimeRoute(`/checkout/return?order=${encodeURIComponent(orderNumber)}`),
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => choose("paid")}
        disabled={pending}
        className="rounded-md bg-[var(--color-ink)] px-4 py-3 text-sm font-medium text-[var(--color-surface)] disabled:opacity-50"
      >
        {pending ? "Working…" : "Simulate a successful payment"}
      </button>
      <button
        type="button"
        onClick={() => choose("failed")}
        disabled={pending}
        className="rounded-md border border-[var(--color-line)] px-4 py-3 text-sm font-medium disabled:opacity-50"
      >
        Simulate a failed payment
      </button>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
