import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { verifyAccessToken, type AccessClaims } from "@/lib/auth/tokens";
import type { Role } from "@/generated/prisma/enums";

/**
 * Reading the caller's identity (SEC-7, SEC-23).
 *
 * Two tiers, and the difference matters:
 *
 *  - `getSessionClaims()` trusts the signed JWT. No DB round trip. Fine for
 *    rendering a header or deciding what to show.
 *  - `getCurrentUser()` and `requireRole()` read the row. A JWT claim is up to
 *    15 minutes stale, so anything that authorises an action — especially an
 *    admin action — must re-check against the database (SEC-7).
 *
 * Both are wrapped in React `cache()`, so a page that asks five times in five
 * components still issues one query per request.
 */

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  emailVerified: Date | null;
}

export const getSessionClaims = cache(async (): Promise<AccessClaims | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
});

/** The authoritative read: role and verification state come from the row. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const claims = await getSessionClaims();
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  return user ?? null;
});

/** The path the proxy recorded for this request, for post-login return. */
async function currentPath(): Promise<string> {
  const value = (await headers()).get("x-pathname");
  return value && value.startsWith("/") ? value : "/account";
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  }
  return user;
}

/** Review submission is gated on a verified address (F1 DoD). */
export async function requireVerifiedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.emailVerified) {
    redirect("/verify-email?required=1");
  }
  return user;
}

/**
 * Whether an unverified shopper may reach checkout.
 *
 * One question asked in four places — the checkout page, the two checkout
 * route handlers, and the cart's checkout button — because a gate enforced on
 * three of them and not the fourth is either a dead end a shopper cannot see
 * coming or a button that 403s after they press it.
 */
export function checkoutRequiresVerifiedEmail(): boolean {
  return serverEnv().REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT;
}

/** True when this user may check out under the current policy. */
export function canCheckOut(user: Pick<CurrentUser, "emailVerified"> | null): boolean {
  if (!user) return false;
  return !checkoutRequiresVerifiedEmail() || user.emailVerified !== null;
}

/**
 * Checkout's page guard. Still requires a session — the order needs an owner
 * (SEC-23) — but the verification half is policy, not structure.
 */
export async function requireCheckoutUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (checkoutRequiresVerifiedEmail() && !user.emailVerified) {
    redirect("/verify-email?required=1");
  }
  return user;
}

/**
 * Server-side RBAC. The role is read from the database on every call, so a
 * demotion takes effect on the demoted user's next request rather than when
 * their access token happens to expire (SEC-7). UI hiding is never a control.
 */
export async function requireRole(...roles: readonly Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    // Not 403: an unauthorised user should not learn that the route exists.
    redirect("/");
  }
  return user;
}

export function hasRole(user: CurrentUser | null, ...roles: readonly Role[]): boolean {
  return user !== null && roles.includes(user.role);
}
