"use client";

import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";

/**
 * Password-reset request.
 *
 * Note what this component cannot display: whether the address is registered.
 * The server answers identically either way (SEC-9), so there is no state here
 * that could leak it.
 */
export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const result = await postJson<{ message: string }>(
      "/api/auth/forgot-password",
      { email: String(form.get("email") ?? "") },
      { retryOnUnauthorized: false },
    );

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDone(result.data.message);
  }

  if (done) return <FormNotice>{done}</FormNotice>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
      />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
