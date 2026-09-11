"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";

/**
 * The floating entry point to the assistant (F5).
 *
 * Three things this file is careful about, all of them NFR rather than
 * security:
 *
 *  - **It cannot regress LCP or CLS.** The launcher is `position: fixed`, so
 *    it is outside the document flow and shifts nothing; it renders after the
 *    session resolves, which is after first paint either way. The panel — and
 *    with it the AI SDK — is a dynamic import that only loads when someone
 *    opens it, so the catalogue pages ship none of it.
 *  - **It respects reduced motion.** The open transition is a CSS transition,
 *    which globals.css already neutralises under
 *    `prefers-reduced-motion: reduce`.
 *  - **It never renders for a visitor who cannot use it.** Signed out, the
 *    button is a sign-in prompt rather than a chat that 401s on first message.
 *    `available` comes from the server (the kill switch and the API key), so a
 *    deployment without Gemini configured simply has no widget.
 */

const AssistantPanel = dynamic(
  () =>
    import("@/components/assistant/assistant-panel").then((mod) => mod.AssistantPanel),
  {
    ssr: false,
    loading: () => (
      <div className="animate-scale-in flex h-40 w-[min(24rem,calc(100vw-2rem))] origin-bottom-right flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-4 shadow-[var(--shadow-panel)]">
        <div className="shimmer h-3 w-32 rounded-full" />
        <div className="shimmer h-3 w-48 rounded-full" />
        <div className="shimmer h-3 w-40 rounded-full" />
      </div>
    ),
  },
);

export function AssistantLauncher({ available }: { available: boolean }) {
  const [open, setOpen] = useState(false);
  const status = useAuthStore((state) => state.status);

  // Escape closes it, like any other dialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // "unknown" means the session request is still in flight; showing nothing is
  // better than showing a sign-in prompt to somebody who is already signed in.
  if (!available || status === "unknown") return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {open ? (
        status === "authenticated" ? (
          <AssistantPanel onClose={() => setOpen(false)} />
        ) : (
          <div className="animate-scale-in w-[min(20rem,calc(100vw-2rem))] origin-bottom-right rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-5 text-sm shadow-[var(--shadow-panel)]">
            <p className="font-display text-base font-semibold">
              Sign in to use the assistant
            </p>
            <p className="mt-1.5 leading-relaxed text-[var(--color-muted)]">
              It adds items to your own cart, so it needs to know whose cart that is.
            </p>
            <Link
              href="/login?next=%2F"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] px-4 py-2 text-xs font-medium text-[var(--color-surface)] transition-[box-shadow,transform] duration-200 ease-[var(--ease-interaction)] hover:shadow-[var(--shadow-lift)] active:translate-y-px"
            >
              Sign in
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        )
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close the shopping assistant" : "Open the shopping assistant"}
        className="group flex items-center gap-2 rounded-full bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-[var(--color-surface)] shadow-[var(--shadow-panel)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-entrance)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:translate-y-0"
      >
        <span
          aria-hidden="true"
          className={`text-[var(--color-accent)] transition-transform duration-500 ease-[var(--ease-entrance)] ${
            open ? "rotate-90" : "group-hover:rotate-12"
          }`}
        >
          {open ? "✕" : "✦"}
        </span>
        {open ? "Close" : "Ask for help"}
      </button>
    </div>
  );
}
