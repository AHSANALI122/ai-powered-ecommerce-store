import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { REFRESH_TOKEN_TTL_SECONDS } from "@/lib/auth/cookies";
import { generateOpaqueToken, hashToken } from "@/lib/auth/tokens";

/**
 * Refresh-token sessions with rotation and reuse detection (SEC-21).
 *
 * One `Session` row per issued refresh token. Every token descended from a
 * single login shares a `familyId`. Rotation marks the presented row
 * `replacedById` and writes a new row. Therefore a token that arrives already
 * revoked or already replaced can only be a copy — the real client would have
 * moved on to the successor — so the entire family is revoked and both the
 * thief and the victim are forced to log in again. That is the intended
 * outcome: a stolen refresh token must not outlive its detection.
 */

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedRefreshToken {
  /** The raw token. Returned once, stored only as a hash. */
  token: string;
  familyId: string;
  expiresAt: Date;
}

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

/** Opens a new session family. Called on login only. */
export async function createSession(
  userId: string,
  context: SessionContext = {},
): Promise<IssuedRefreshToken> {
  const token = generateOpaqueToken();
  const familyId = randomUUID();
  const expiresAt = expiryFromNow();

  await prisma.session.create({
    data: {
      userId,
      familyId,
      refreshTokenHash: hashToken(token),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ip: context.ip ?? null,
      expiresAt,
    },
  });

  return { token, familyId, expiresAt };
}

export type RotationResult =
  | {
      ok: true;
      userId: string;
      familyId: string;
      token: string;
      expiresAt: Date;
    }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/**
 * Exchanges a valid refresh token for its successor.
 *
 * The claim is a conditional `updateMany` guarded on the row still being
 * unrevoked and unreplaced. Two concurrent refreshes with the same token
 * therefore cannot both succeed: the loser sees 0 affected rows and is treated
 * as a replay, which is the conservative reading.
 */
export async function rotateRefreshToken(
  rawToken: string,
  context: SessionContext = {},
): Promise<RotationResult> {
  const presentedHash = hashToken(rawToken);

  const existing = await prisma.session.findUnique({
    where: { refreshTokenHash: presentedHash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      revokedAt: true,
      replacedById: true,
      expiresAt: true,
    },
  });

  if (!existing) return { ok: false, reason: "invalid" };

  // Already revoked or already rotated ⇒ this token was replayed (SEC-21).
  if (existing.revokedAt !== null || existing.replacedById !== null) {
    await revokeFamily(existing.familyId);
    return { ok: false, reason: "reused" };
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    await prisma.session.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  const successorId = randomUUID();
  const claimed = await prisma.session.updateMany({
    where: { id: existing.id, revokedAt: null, replacedById: null },
    data: { replacedById: successorId, revokedAt: new Date() },
  });

  if (claimed.count === 0) {
    // Lost the race against a concurrent rotation of the same token.
    await revokeFamily(existing.familyId);
    return { ok: false, reason: "reused" };
  }

  const token = generateOpaqueToken();
  const expiresAt = expiryFromNow();

  await prisma.session.create({
    data: {
      id: successorId,
      userId: existing.userId,
      familyId: existing.familyId,
      refreshTokenHash: hashToken(token),
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      ip: context.ip ?? null,
      expiresAt,
    },
  });

  return {
    ok: true,
    userId: existing.userId,
    familyId: existing.familyId,
    token,
    expiresAt,
  };
}

/** Revokes every token descended from one login. */
export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Logout: kills only the presented token's family, not other devices. */
export async function revokeSessionByToken(rawToken: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(rawToken) },
    select: { familyId: true },
  });
  if (session) await revokeFamily(session.familyId);
}

/** Password reset and password change: every device is signed out (SEC-10). */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping for a future cron: expired rows carry no security value. */
export async function deleteExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
