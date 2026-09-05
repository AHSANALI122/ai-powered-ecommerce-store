"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";
import { useAuthStore, type SessionUser } from "@/stores/auth";
import { FormError, SubmitButton, TextField } from "@/components/ui/form";
import { runtimeRoute } from "@/lib/routes";

/**
 * Sign-in form.
 *
 * The response carries no token — the server sets httpOnly cookies (AD-3) — so
 * all this does with a success is update the display store and navigate.
 * `router.refresh()` re-renders the server tree so the header and any
 * owner-scoped page pick up the new session.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const result = await postJson<{ user: SessionUser }>(
      "/api/auth/login",
      {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      // A 401 here means "wrong password", not "expired session"; refreshing
      // and replaying would just double the work.
      { retryOnUnauthorized: false },
    );

    if (!result.ok) {
      setPending(false);
      setError(result.error.message);
      return;
    }

    setUser(result.data.user);
    router.replace(runtimeRoute(next));
    router.refresh();
  }

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
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={200}
      />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
    </form>
  );
}
