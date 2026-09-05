"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, postJson } from "@/lib/client/api";
import { useAuthStore, type SessionUser } from "@/stores/auth";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";

export function ProfileForm({ initialName }: { initialName: string }) {
  const setUser = useAuthStore((state) => state.setUser);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    const result = await apiFetch<{ user: SessionUser }>("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: String(form.get("name") ?? "").trim() }),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      setFieldErrors(result.error.fieldErrors ?? {});
      return;
    }

    setUser(result.data.user);
    setNotice("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>
      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        maxLength={80}
        required
        defaultValue={initialName}
        errors={fieldErrors.name}
      />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}

/**
 * Changing the password signs every device out, this one included — so on
 * success the page navigates to sign-in rather than pretending the session
 * survived (SEC-10).
 */
export function PasswordForm() {
  const router = useRouter();
  const clear = useAuthStore((state) => state.clear);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setFieldErrors({});

    const result = await postJson<{ message: string }>(
      "/api/account/password",
      {
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword: String(form.get("newPassword") ?? ""),
      },
      { retryOnUnauthorized: false },
    );

    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      setFieldErrors(result.error.fieldErrors ?? {});
      return;
    }

    clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4" noValidate>
      <FormError>{error}</FormError>
      <TextField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        maxLength={200}
      />
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        maxLength={200}
        hint="At least 10 characters, with a letter and a number."
        errors={fieldErrors.newPassword}
      />
      <SubmitButton pending={pending}>Change password</SubmitButton>
      <p className="text-xs text-[var(--color-muted)]">
        This signs you out on every device.
      </p>
    </form>
  );
}

export function ResendVerificationButton({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function resend() {
    if (pending) return;
    setPending(true);
    const result = await postJson<{ message: string }>(
      "/api/auth/resend-verification",
      { email },
      { retryOnUnauthorized: false },
    );
    setPending(false);
    setNotice(
      result.ok ? result.data.message : "Could not send right now. Try again shortly.",
    );
  }

  if (notice) return <FormNotice>{notice}</FormNotice>;

  return (
    <button
      type="button"
      onClick={resend}
      disabled={pending}
      className="self-start rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-60"
    >
      {pending ? "Sending…" : "Resend confirmation email"}
    </button>
  );
}
