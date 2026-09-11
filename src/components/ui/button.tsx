import type { ButtonHTMLAttributes } from "react";

/**
 * The one place a button's shape is decided.
 *
 * A function that returns classes rather than a `<Button>` component, because
 * half the buttons on this site are `<Link>`s — "Shop this piece", "Continue
 * to checkout", "Back to the catalogue" — and a component that wraps `<button>`
 * would have those rendering the wrong element or reaching for `asChild`
 * machinery. Classes compose with both, and with a server component.
 *
 * The interaction is deliberately small: colour and shadow on hover, a 1px
 * translate on press. A button that grows on hover is a button that nudges the
 * layout around it; a button that dips on press is one you can feel.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-medium " +
  "transition-[transform,background-color,border-color,box-shadow,opacity] duration-200 " +
  "ease-[var(--ease-interaction)] active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-ink)] text-[var(--color-surface)] shadow-[var(--shadow-card)] " +
    "hover:shadow-[var(--shadow-lift)] hover:brightness-110",
  accent:
    "bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-card)] " +
    "hover:shadow-[var(--shadow-lift)] hover:brightness-105",
  secondary:
    "border border-[var(--color-line)] bg-[var(--color-elevated)] text-[var(--color-ink)] " +
    "hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)]",
  ghost:
    "text-[var(--color-ink)] hover:bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-sm",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The `<button>` case of the same thing, for when there is no link to wrap. */
export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className: className ?? "" })}
      {...props}
    />
  );
}

/**
 * A boxed surface: the panel every list, summary and form sits in.
 *
 * `--color-elevated` rather than the page background, so a card reads as a
 * plane above the page in both themes without a border doing all the work.
 */
export function surfaceClass(className = ""): string {
  return [
    "rounded-[var(--radius-card)] border border-[var(--color-line)]",
    "bg-[var(--color-elevated)] shadow-[var(--shadow-card)]",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Loading placeholder.
 *
 * Sized by the caller and animated by the shared `shimmer` utility, so a
 * skeleton is always the same sweep at the same speed wherever it appears —
 * which is what makes it read as the page loading rather than as a component
 * doing something of its own.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`shimmer rounded-md ${className}`.trim()} />;
}
