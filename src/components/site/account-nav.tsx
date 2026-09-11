"use client";

import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { SignOutButton } from "@/components/site/sign-out-button";

/**
 * Account links in the header.
 *
 * Until the session is known this renders a neutral "Account" link that works
 * for everyone — signed out, it lands on /account, which redirects to sign-in.
 * So the header is useful on first paint and never shows the wrong thing, and
 * the page it sits in stays cacheable (see session-loader.tsx).
 */
export function AccountNav() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  if (status === "unknown") {
    return (
      <Link href="/account" className="link-sweep text-sm">
        Account
      </Link>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-4 text-sm">
        <Link href="/login" className="link-sweep">
          Sign in
        </Link>
        <Link
          href="/register"
          className="link-sweep text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      {user.role === "ADMIN" || user.role === "STAFF" ? (
        // A label, not a control. The dashboard link lands here in F4; access
        // is enforced by the proxy and re-checked against the user row on every
        // admin route (SEC-7).
        <span className="rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent)]">
          {user.role.toLowerCase()}
        </span>
      ) : null}
      <Link href="/account" className="link-sweep max-w-28 truncate">
        {user.name ?? "Account"}
      </Link>
      <SignOutButton />
    </div>
  );
}
