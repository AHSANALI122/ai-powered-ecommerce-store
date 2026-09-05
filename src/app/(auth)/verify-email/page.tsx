import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { VerifyEmailClient } from "./verify-email-client";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage(props: PageProps<"/verify-email">) {
  const params = await props.searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const required = params.required === "1";

  // Only to prefill the resend field. Nothing on this page depends on being
  // signed in — a verification link is often opened in a different browser
  // from the one that registered.
  const user = await getCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {token ? "Confirming your email" : "Confirm your email"}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {required
            ? "Checkout and reviews need a confirmed address. Browsing does not."
            : "We sent a link to your inbox. It expires in 24 hours."}
        </p>
      </div>

      <VerifyEmailClient token={token} defaultEmail={user?.email ?? ""} />
    </div>
  );
}
