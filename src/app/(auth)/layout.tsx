import type { Metadata } from "next";

/**
 * Account-entry screens.
 *
 * `noindex` for the whole group (spec §7): sign-in, registration and password
 * screens have no search value, and an indexed reset page invites crawlers to
 * consume single-use tokens.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <div className="animate-scale-in rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] p-7 shadow-[var(--shadow-card)]">
        {children}
      </div>
    </div>
  );
}
