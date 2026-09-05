import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect("/account");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Track orders, save addresses, keep a wishlist.
        </p>
      </div>

      <RegisterForm />

      <p className="text-sm text-[var(--color-muted)]">
        Already have one?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
