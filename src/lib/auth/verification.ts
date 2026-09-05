import { prisma } from "@/lib/db";
import { generateOpaqueToken, hashToken } from "@/lib/auth/tokens";
import type { TokenType } from "@/generated/prisma/enums";

/**
 * Email-verification and password-reset tokens (SEC-10).
 *
 * Hashed at rest, typed so a verification link cannot be replayed as a reset,
 * single-use through `usedAt`, and expiring. Issuing a new token of a type
 * invalidates the outstanding ones of that type, so a forwarded old email
 * stops working the moment a new one is requested.
 */

export const TOKEN_TTL_SECONDS: Record<TokenType, number> = {
  EMAIL_VERIFY: 60 * 60 * 24, // 24 hours
  PASSWORD_RESET: 60 * 60, // 1 hour — shorter, it can take over an account
};

export async function issueVerificationToken(
  userId: string,
  type: TokenType,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS[type] * 1000);

  // Supersede outstanding tokens of the same type before issuing a new one.
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

export type ConsumeResult =
  { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Redeems a token exactly once. The `updateMany` guarded on `usedAt: null` is
 * what makes that atomic: two simultaneous clicks on the same reset link give
 * one success and one "used".
 */
export async function consumeVerificationToken(
  rawToken: string,
  type: TokenType,
): Promise<ConsumeResult> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true },
  });

  if (!record || record.type !== type) return { ok: false, reason: "invalid" };
  if (record.usedAt !== null) return { ok: false, reason: "used" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const claimed = await prisma.verificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: "used" };

  return { ok: true, userId: record.userId };
}

/** Invalidates every outstanding token of a type — used after a reset lands. */
export async function invalidateTokens(userId: string, type: TokenType): Promise<void> {
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
}
