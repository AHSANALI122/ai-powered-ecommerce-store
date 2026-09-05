import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeRelativePath } from "@/lib/safe-redirect";
import { runtimeRoute } from "@/lib/routes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  // `next` is attacker-controlled: it arrives in a URL anyone can craft and
  // send. Validated here so a "sign in to continue" link cannot be turned into
  // an open redirect to a lookalike site (see safe-redirect.ts).
  const next = safeRelativePath(params.next, "/account");

  const user = await getCurrentUser();
  if (user) redirect(runtimeRoute(next));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Welcome back. Your cart travels with you.
        </p>
      </div>

      <LoginForm next={next} />

      <div className="flex flex-col gap-2 text-sm text-[var(--color-muted)]">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot your password?
        </Link>
        <p>
          New here?{" "}
          <Link href="/register" className="underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
