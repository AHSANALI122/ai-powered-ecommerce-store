import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import {
  checkoutRequiresVerifiedEmail,
  getSessionClaims,
  type CurrentUser,
} from "@/lib/auth/current-user";
import type { Role } from "@/generated/prisma/enums";

/**
 * Route-handler equivalents of the page guards in current-user.ts. Pages
 * redirect; an API must answer with a status code, so the two cannot share one
 * implementation.
 *
 * Every one of these re-reads the user row rather than trusting the JWT claim,
 * because a route handler is where state changes and a 15-minute-stale role is
 * exactly the window an attacker wants (SEC-7).
 */

export type Guard<T> = { ok: true; user: T } | { ok: false; response: NextResponse };

export async function requireApiUser(): Promise<Guard<CurrentUser>> {
  const claims = await getSessionClaims();
  if (!claims) {
    return { ok: false, response: jsonError("UNAUTHORIZED", "Authentication required.") };
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  if (!user) {
    // Token signed for a user that no longer exists.
    return { ok: false, response: jsonError("UNAUTHORIZED", "Authentication required.") };
  }

  return { ok: true, user };
}

/** Review submission requires a verified address (F1 DoD). */
export async function requireApiVerifiedUser(): Promise<Guard<CurrentUser>> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard;
  if (!guard.user.emailVerified) {
    return {
      ok: false,
      response: jsonError("FORBIDDEN", "Verify your email address to continue."),
    };
  }
  return guard;
}

/**
 * Checkout's route-handler guard. The session is still required — an order
 * needs an owner — but whether an unverified address may buy is policy, read
 * from the same place the page guard and the cart button read it, so the
 * button, the page and the POST can never disagree.
 */
export async function requireApiCheckoutUser(): Promise<Guard<CurrentUser>> {
  if (checkoutRequiresVerifiedEmail()) return requireApiVerifiedUser();
  return requireApiUser();
}

/**
 * RBAC against the database, never against a client-supplied field. A body
 * containing `role: "ADMIN"` is rejected earlier still, by the `.strict()` Zod
 * schema that has no such key (SEC-16).
 */
export async function requireApiRole(
  ...roles: readonly Role[]
): Promise<Guard<CurrentUser>> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard;
  if (!roles.includes(guard.user.role)) {
    return { ok: false, response: jsonError("FORBIDDEN", "Not permitted.") };
  }
  return guard;
}
