"use client";

import { useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";

/**
 * Sets a new password from a reset link.
 *
 * The token stays in component state and is posted in the body rather than
 * being re-read from the URL at submit time. On success every session for the
 * account is revoked server-side (SEC-10), so the next step is a fresh sign-in
 * — including for whoever may have been in the account already.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setFieldErrors({});

    const result = await postJson<{ message: string }>(
      "/api/auth/reset-password",
      { token, password: String(form.get("password") ?? "") },
      { retryOnUnauthorized: false },
    );

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      setFieldErrors(result.error.fieldErrors ?? {});
      return;
    }
    setDone(result.data.message);
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <FormNotice>{done}</FormNotice>
        <Link href="/login" className="text-sm underline underline-offset-4">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={200}
        hint="At least 10 characters, with a letter and a number."
        errors={fieldErrors.password}
      />
      <SubmitButton pending={pending}>Set new password</SubmitButton>
      <p className="text-xs text-[var(--color-muted)]">
        Setting a new password signs you out everywhere.
      </p>
    </form>
  );
}
