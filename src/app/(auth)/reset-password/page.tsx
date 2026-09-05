import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const params = await props.searchParams;
  const raw = params.token;
  const token = typeof raw === "string" ? raw : "";

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Link incomplete</h1>
        <p className="text-sm text-[var(--color-muted)]">
          This page needs the token from your reset email. Request a new link and open it
          directly from the message.
        </p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-4">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">This link works once.</p>
      </div>
      <ResetPasswordForm token={token} />
    </div>
  );
}
