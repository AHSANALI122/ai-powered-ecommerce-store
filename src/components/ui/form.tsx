"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";

/**
 * Small form primitives shared by the account screens.
 *
 * They exist for accessibility consistency rather than looks: every field gets
 * a real `<label>` tied by id, errors are associated through
 * `aria-describedby` and announced, and the invalid state is exposed to
 * assistive technology rather than only shown in red (spec §7).
 */

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  errors?: string[] | undefined;
}

export function TextField({ label, hint, errors, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasErrors = Boolean(errors?.length);
  const describedBy =
    [hint ? hintId : null, hasErrors ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...input}
        aria-invalid={hasErrors || undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)] aria-[invalid=true]:border-red-600"
      />
      {hint ? (
        <p id={hintId} className="text-xs text-[var(--color-muted)]">
          {hint}
        </p>
      ) : null}
      {hasErrors ? (
        <p id={errorId} className="text-xs text-red-600">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-sm text-red-700 dark:text-red-400"
    >
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-[var(--color-line)] bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.04]"
    >
      {children}
    </p>
  );
}

export function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)] transition-opacity disabled:opacity-60"
    >
      {pending ? "Working…" : children}
    </button>
  );
}
