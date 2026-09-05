import { prisma } from "@/lib/db";
import { hashPassword, fakeVerifyPassword, verifyPassword } from "@/lib/auth/password";
import { signAccessToken } from "@/lib/auth/tokens";
import {
  createSession,
  revokeAllSessionsForUser,
  type SessionContext,
} from "@/lib/auth/session";
import {
  consumeVerificationToken,
  invalidateTokens,
  issueVerificationToken,
} from "@/lib/auth/verification";
import { setAuthCookies, type CookieWriter } from "@/lib/auth/cookies";
import {
  appUrl,
  logActionLinkInDev,
  queueNotification,
} from "@/server/notifications/queue";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { Role } from "@/generated/prisma/enums";

/**
 * Account flows (F1). The route handlers above this file do transport concerns
 * — rate limiting, CSRF, cookies, status codes — and nothing else.
 *
 * The rule that shapes every function here: an unauthenticated caller learns
 * nothing about which email addresses exist (SEC-9). Register, forgot-password
 * and resend-verification all take the same path and produce the same response
 * whether or not the account is real, and spend comparable time doing it.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  emailVerified: Date | null;
}

/** What the browser is allowed to know about the signed-in user (AD-3). */
export function publicUser(user: AuthUser | CurrentUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified !== null,
  };
}

// ---------------------------------------------------------------------------
// Registration and email verification
// ---------------------------------------------------------------------------

export async function registerUser(input: {
  name?: string | undefined;
  email: string;
  password: string;
}): Promise<void> {
  // Hash first, unconditionally: this is the expensive step, and doing it on
  // both branches keeps "email taken" and "email free" indistinguishable in
  // wall-clock time.
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, emailVerified: true },
  });

  if (existing) {
    // Never reveal the collision. Re-sending verification to an unverified
    // account is a genuine convenience and leaks nothing: the mail goes to the
    // address's real owner, not to the caller.
    if (!existing.emailVerified) {
      await sendVerificationEmail(existing);
    }
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name ?? null,
      passwordHash,
      // `role` is never taken from input. No code path in this application
      // lets a request choose its own role (SEC-7).
    },
    select: { id: true, email: true, name: true },
  });

  await sendVerificationEmail(user);
  await queueNotification({
    type: "WELCOME",
    to: user.email,
    userId: user.id,
    subject: "Welcome to the store",
    payload: { name: user.name },
  });
}

export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  name?: string | null;
}): Promise<void> {
  const { token, expiresAt } = await issueVerificationToken(user.id, "EMAIL_VERIFY");
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);

  await queueNotification({
    type: "EMAIL_VERIFICATION",
    to: user.email,
    userId: user.id,
    subject: "Confirm your email address",
    // The raw token exists only in this payload and in the mail itself; the
    // database stores its hash (SEC-10).
    payload: { link, expiresAt: expiresAt.toISOString(), name: user.name ?? null },
  });

  logActionLinkInDev(`Verify ${user.email}`, link);
}

export type VerifyEmailResult =
  { ok: true; user: AuthUser } | { ok: false; reason: "invalid" | "expired" | "used" };

export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  const consumed = await consumeVerificationToken(token, "EMAIL_VERIFY");
  if (!consumed.ok) return consumed;

  const user = await prisma.user.update({
    where: { id: consumed.userId },
    data: { emailVerified: new Date() },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  return { ok: true, user };
}

/** Resend, addressed by email. Silent when the account is absent or verified. */
export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, emailVerified: true },
  });
  if (!user || user.emailVerified) return;
  await sendVerificationEmail(user);
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Returns the user on a correct password, null otherwise — with no distinction
 * between "no such account" and "wrong password", in either the value or the
 * time taken (SEC-9).
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      passwordHash: true,
    },
  });

  if (!user) {
    await fakeVerifyPassword();
    return null;
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
  };
}

/**
 * Opens a session: a new refresh-token family plus a short-lived access token,
 * both written as httpOnly cookies. The caller passes the response (route
 * handler) or the cookie store (server action) as the writer.
 */
export async function establishSession(
  writer: CookieWriter,
  user: AuthUser,
  context: SessionContext = {},
): Promise<void> {
  const refresh = await createSession(user.id, context);
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    ev: user.emailVerified !== null,
    fam: refresh.familyId,
  });
  setAuthCookies(writer, { accessToken, refreshToken: refresh.token });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function startPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) return; // Same generic response upstream either way (SEC-9).

  const { token, expiresAt } = await issueVerificationToken(user.id, "PASSWORD_RESET");
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);

  await queueNotification({
    type: "PASSWORD_RESET",
    to: user.email,
    userId: user.id,
    subject: "Reset your password",
    payload: { link, expiresAt: expiresAt.toISOString(), name: user.name },
  });

  logActionLinkInDev(`Reset ${user.email}`, link);
}

export type ResetResult =
  { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Consumes the reset token, sets the new password and signs every device out
 * (SEC-10). If the reset was triggered because an account was taken over,
 * leaving the attacker's refresh token alive would make the reset pointless.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  const consumed = await consumeVerificationToken(token, "PASSWORD_RESET");
  if (!consumed.ok) return consumed;

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: consumed.userId },
    data: {
      passwordHash,
      // Proving control of the inbox is exactly what email verification
      // establishes, so a completed reset also verifies the address.
      emailVerified: new Date(),
    },
  });

  await Promise.all([
    revokeAllSessionsForUser(consumed.userId),
    invalidateTokens(consumed.userId, "PASSWORD_RESET"),
  ]);

  return { ok: true };
}

/** Signed-in password change. Also revokes other sessions. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) return false;
  if (!(await verifyPassword(user.passwordHash, currentPassword))) return false;

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await revokeAllSessionsForUser(userId);
  return true;
}
