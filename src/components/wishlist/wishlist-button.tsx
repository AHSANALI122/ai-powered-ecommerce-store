"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";

/**
 * The save-to-wishlist control (F6).
 *
 * Optimistic, and it says so: the heart flips immediately and reverts if the
 * request fails, because the round trip is long enough to feel broken and the
 * failure is rare enough to be worth handling as an exception rather than as
 * the default.
 *
 * A signed-out visitor gets a control that sends them to sign in rather than a
 * hidden one — a wishlist is a reason to make an account, and a heart that
 * silently does nothing is worse than one that explains itself.
 */
export function WishlistButton({
  productId,
  signedIn,
  initiallySaved,
  variant = "icon",
}: {
  productId: string;
  signedIn: boolean;
  initiallySaved: boolean;
  variant?: "icon" | "full";
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    const next = !saved;
    setSaved(next); // Optimistic.
    setError(null);

    startTransition(async () => {
      const result = next
        ? await postJson<{ added: boolean }>("/api/wishlist", { productId })
        : await apiFetch<{ ok: boolean }>(`/api/wishlist/${productId}`, {
            method: "DELETE",
          });

      if (!result.ok) {
        setSaved(!next); // Revert: the server is the truth.
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  const label = saved ? "Remove from wishlist" : "Save to wishlist";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        // `aria-pressed` is what makes this a toggle to a screen reader; the
        // filled glyph alone communicates nothing.
        aria-pressed={saved}
        aria-label={variant === "icon" ? label : undefined}
        title={label}
        className={
          variant === "full"
            ? "inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-line)] px-5 py-3 text-sm font-medium transition-[background-color,border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:border-[var(--color-ink)] hover:bg-[var(--color-subtle)] hover:shadow-[var(--shadow-card)] active:translate-y-px disabled:opacity-60"
            : "inline-flex size-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)]/90 text-base transition-[background-color,border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)] active:translate-y-px disabled:opacity-60"
        }
      >
        {/* Keyed on the state so the glyph remounts and the pop replays each
            time it is filled — the same trick the cart badge uses. */}
        <span
          key={saved ? "saved" : "unsaved"}
          aria-hidden="true"
          className={saved ? "animate-pop text-red-600" : ""}
        >
          {saved ? "♥" : "♡"}
        </span>
        {variant === "full" ? <span>{saved ? "Saved" : "Save"}</span> : null}
      </button>

      {error ? (
        <p role="alert" className="animate-fade-in text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
