import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * Presentational admin pieces with no interactivity.
 *
 * Deliberately **not** a `"use client"` module. These are used from both server
 * pages (the listings) and client components (the editors), and a shared module
 * without the directive compiles into whichever graph imports it. Marking it
 * client would make every listing page a client boundary — and, concretely,
 * would break `Pager`, whose `buildHref` is a plain function that cannot cross
 * a server → client boundary.
 *
 * The interactive pieces — inputs, buttons — live in `ui.tsx`, which is a
 * client module. That split is the whole reason there are two files.
 */

/** Wide tables must scroll inside their own box, never scroll the page. */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
      <table className="w-full min-w-[46rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`border-b border-[var(--color-line)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)] ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`border-b border-[var(--color-line)] px-3 py-2 align-middle ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-[var(--color-line)] text-[var(--color-muted)]",
  good: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  bad: "border-red-600/40 text-red-700 dark:text-red-400",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-sm text-[var(--color-muted)]">
      {children}
    </p>
  );
}

/**
 * Link-based pagination, so a page of results is addressable and the back
 * button works. `buildHref` receives an already-validated page number and the
 * caller owns the query string — which only works because this module renders
 * on the server; a client component could not be handed that function at all.
 */
export function Pager({
  page,
  pageCount,
  total,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  buildHref: (page: number) => Route;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-[var(--color-muted)]">
        {total.toLocaleString()} result{total === 1 ? "" : "s"} · page {page} of{" "}
        {pageCount}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            rel="prev"
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5"
          >
            Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5"
          >
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}
