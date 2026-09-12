import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { SignOutButton } from "@/components/site/sign-out-button";
import { PasswordForm, ProfileForm, ResendVerificationButton } from "./account-forms";

/** Account pages are never indexed (spec §7). */
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

/** Nothing here may be cached: it is one specific person's data. */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // Redirects to /login when there is no session. The proxy also blocks
  // /account, but this is the control — the proxy is only defence in depth.
  const user = await requireUser();

  // Owner-scoped by construction: userId is in the where clause, not applied
  // to the result after fetching (SEC-23).
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
    take: 10,
  });

  return (
    <div className="flex flex-col gap-10 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
          <p className="mt-1 truncate text-sm text-[var(--color-muted)]">{user.email}</p>
        </div>
        {/* The header's sign-out is hidden on a phone, where the top row has no
            room for it — so it has to exist somewhere a phone can reach, and
            the account page is where someone would look for it anyway. */}
        <span className="shrink-0 text-sm sm:hidden">
          <SignOutButton />
        </span>
      </header>

      {!user.emailVerified ? (
        <section className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold">Confirm your email address</h2>
          <p className="text-sm text-[var(--color-muted)]">
            You can browse and build a cart now. Checking out and leaving reviews need a
            confirmed address.
          </p>
          <ResendVerificationButton email={user.email} />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Profile</h2>
        <ProfileForm initialName={user.name ?? ""} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Password</h2>
        <PasswordForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Active sessions</h2>
        <p className="text-sm text-[var(--color-muted)]">
          One row per device that has signed in and not signed out. Changing your password
          ends all of them.
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="rounded-md border border-[var(--color-line)] px-3 py-2"
            >
              <span className="block truncate">
                {session.userAgent ?? "Unknown device"}
              </span>
              <span className="text-xs text-[var(--color-muted)]">
                Signed in {session.createdAt.toISOString().slice(0, 10)} · expires{" "}
                {session.expiresAt.toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Orders, addresses and saved items</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/account/orders"
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
          >
            Your orders
          </Link>
          <Link
            href="/account/addresses"
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
          >
            Your addresses
          </Link>
          <Link
            href="/account/wishlist"
            className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
          >
            Your wishlist
          </Link>
        </div>
      </section>
    </div>
  );
}
