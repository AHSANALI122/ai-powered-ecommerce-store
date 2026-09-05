"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. The digest is safe to surface; the message is
 * not, so it is logged rather than rendered.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <section className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        The page could not be rendered. Try again in a moment.
      </p>
      {error.digest ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Reference: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded border border-[var(--color-line)] px-4 py-2 text-sm"
      >
        Try again
      </button>
    </section>
  );
}
