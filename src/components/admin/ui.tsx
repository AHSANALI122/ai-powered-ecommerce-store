"use client";

import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";

/**
 * Interactive admin primitives.
 *
 * The storefront's `components/ui/form.tsx` covers labelled text inputs; these
 * are the interactive pieces only the dashboard needs — selects, textareas,
 * checkboxes and buttons. Same accessibility contract as the originals: a real
 * `<label>` bound by id, errors associated by `aria-describedby`, and state
 * exposed to assistive technology rather than only shown in colour.
 *
 * Everything here needs a hook or a handler, which is what earns the
 * `"use client"`. The purely presentational pieces — tables, badges, the pager —
 * live in `table.tsx` without the directive, so a server-rendered listing does
 * not become a client boundary just to draw a table.
 */

export function SelectField({
  label,
  errors,
  children,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  label: string;
  errors?: string[];
  children: ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hasErrors = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        {...select}
        aria-invalid={hasErrors || undefined}
        aria-describedby={hasErrors ? errorId : undefined}
        className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)]"
      >
        {children}
      </select>
      {hasErrors ? (
        <p id={errorId} className="text-xs text-red-600">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  errors,
  ...textarea
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  hint?: string;
  errors?: string[];
}) {
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
      <textarea
        id={id}
        rows={5}
        {...textarea}
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

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-[var(--color-line)]"
      />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
}) {
  const base =
    "rounded-md border px-3 py-1.5 text-sm transition-opacity disabled:opacity-50";
  const tones = {
    default: "border-[var(--color-line)]",
    primary:
      "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-surface)]",
    danger: "border-red-600/40 text-red-700 dark:text-red-400",
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
