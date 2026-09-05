"use client";

import { useEffect } from "react";

/** Last-resort boundary: catches failures in the root layout itself. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem" }}>The application failed to load</h1>
        <p style={{ color: "#666", fontSize: "0.875rem" }}>
          {error.digest ? `Reference: ${error.digest}` : "No further detail available."}
        </p>
        <button type="button" onClick={reset} style={{ marginTop: "1.5rem" }}>
          Reload
        </button>
      </body>
    </html>
  );
}
