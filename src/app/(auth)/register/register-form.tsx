"use client";

import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";

/**
 * Registration form.
 *
 * On success the user is told to check their inbox — never whether the address
 * was already taken, because the server does not tell us either (SEC-9). Field
 * errors come back from the same Zod schema the handler validates with, so the
 * two can never drift apart.
 */
export function RegisterForm() {
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

    const name = String(form.get("name") ?? "").trim();
    const result = await postJson<{ message: string }>(
      "/api/auth/register",
      {
        ...(name ? { name } : {}),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
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

  if (done) return <FormNotice>{done}</FormNotice>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        maxLength={80}
        hint="Optional."
        errors={fieldErrors.name}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        errors={fieldErrors.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={200}
        hint="At least 10 characters, with a letter and a number."
        errors={fieldErrors.password}
      />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}
