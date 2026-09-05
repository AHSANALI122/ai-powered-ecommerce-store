import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { AdminNav } from "@/components/admin/admin-nav";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s · Admin",
  },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The admin shell (F4, SEC-7).
 *
 * `requireRole` reads the user row from the database on every request, so a
 * demotion takes effect on the demoted user's next navigation rather than when
 * their access token happens to expire. The proxy also turns `/admin` away
 * without a STAFF/ADMIN claim, but that is a saved render, not the control —
 * a JWT claim is up to fifteen minutes stale and the proxy never touches the
 * database. Every API route under `/api/admin` repeats the check for the same
 * reason: authorisation belongs next to the thing being authorised.
 *
 * Layouts do not re-run on client-side navigation between sibling pages, so
 * each admin page performs its own guard as well rather than inheriting this
 * one. That is not defensive duplication — it is the only version that holds.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireRole("STAFF", "ADMIN");

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-line)] pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Store admin</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Signed in as {user.email} · {user.role}
          </p>
        </div>
      </div>
      <AdminNav canManageSettings={user.role === "ADMIN"} />
      {children}
    </div>
  );
}
