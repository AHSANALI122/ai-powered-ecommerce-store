import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Enter your email and we will send a link. It expires in an hour and works once.
        </p>
      </div>

      <ForgotPasswordForm />

      <Link href="/login" className="text-sm underline underline-offset-4">
        Back to sign in
      </Link>
    </div>
  );
}
