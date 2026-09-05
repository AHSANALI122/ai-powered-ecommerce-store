import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { serverEnv } from "@/lib/env";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/lib/auth/cookies";

/**
 * Token primitives (SEC-10, SEC-22).
 *
 * Two kinds of token exist in this system and they are deliberately different:
 *
 *  - the **access token** is a signed, stateless JWT with a short TTL. It is
 *    fast to check (no DB round trip) and cannot be revoked, which is exactly
 *    why it expires in 15 minutes.
 *  - **refresh / verification / reset tokens** are opaque random bytes. Only
 *    their sha256 is stored, so a database leak yields nothing usable.
 */

const ISSUER = "atlas-store";
const AUDIENCE = "atlas-store:web";

let cachedKey: Uint8Array | undefined;

function secretKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = serverEnv().AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Generate one with `openssl rand -base64 48` and put it in .env.",
    );
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

/** Claims kept intentionally small: no email, no name, nothing sensitive. */
export interface AccessClaims {
  /** User id. */
  sub: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
  /** Email verified at issue time. Gates checkout and reviews. */
  ev: boolean;
  /** Session family, so a token can be tied back to the login that made it. */
  fam: string;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, ev: claims.ev, fam: claims.fam })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Returns null for anything that is not a currently valid token — expired,
 * tampered, wrong issuer, or shaped unexpectedly. Callers treat null as
 * "not signed in"; they never see why.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });

    const role = payload.role;
    const fam = payload.fam;
    if (
      typeof payload.sub !== "string" ||
      (role !== "CUSTOMER" && role !== "STAFF" && role !== "ADMIN") ||
      typeof fam !== "string"
    ) {
      return null;
    }

    return { sub: payload.sub, role, ev: payload.ev === true, fam };
  } catch {
    return null;
  }
}

/** 32 bytes of CSPRNG entropy, url-safe. Used for refresh, verify and reset. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * sha256, hex. Fast is fine here — the input is 256 bits of entropy, not a
 * password, so there is nothing to brute force.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time string comparison for tokens compared in application code. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // timingSafeEqual throws on length mismatch; compare against self to keep
    // the work constant, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
