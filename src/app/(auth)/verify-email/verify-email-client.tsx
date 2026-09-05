"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";
import { useAuthStore, type SessionUser } from "@/stores/auth";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";

/**
 * Email confirmation.
 *
 * The token is redeemed with a POST rather than by the GET that opened the
 * page. Mail clients and security scanners prefetch links, and a single-use
 * token consumed by a scanner is a token the recipient never gets to use. The
 * POST also carries the CSRF header, keeping this endpoint consistent with
 * every other mutation (SEC-1).
 */

function VerifyToken({ token }: { token: string }) {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Strict Mode mounts effects twice in development; without this guard the
    // second run would redeem an already-consumed token and report failure.
    if (started.current) return;
    started.current = true;

    void (async () => {
      const result = await postJson<{ user: SessionUser }>(
        "/api/auth/verify-email",
        { token },
        { retryOnUnauthorized: false },
      );

      if (!result.ok) {
        setState("failed");
        setMessage(result.error.message);
        return;
      }

      setUser(result.data.user);
      setState("done");
      router.refresh();
    })();
  }, [token, router, setUser]);

  if (state === "working") {
    return <p className="text-sm text-[var(--color-muted)]">Confirming your address…</p>;
  }

  if (state === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <FormError>{message}</FormError>
        <Link href="/verify-email" className="text-sm underline underline-offset-4">
          Send a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormNotice>Your email address is confirmed.</FormNotice>
      <Link href="/account" className="text-sm underline underline-offset-4">
        Go to your account
      </Link>
    </div>
  );
}

function ResendForm({ defaultEmail }: { defaultEmail: string }) {
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
      "/api/auth/resend-verification",
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
        defaultValue={defaultEmail}
      />
      <SubmitButton pending={pending}>Send a new link</SubmitButton>
    </form>
  );
}

export function VerifyEmailClient({
  token,
  defaultEmail,
}: {
  token: string | null;
  defaultEmail: string;
}) {
  return token ? (
    <VerifyToken token={token} />
  ) : (
    <ResendForm defaultEmail={defaultEmail} />
  );
}
