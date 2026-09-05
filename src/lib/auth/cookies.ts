import { serverEnv } from "@/lib/env";
import { ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE } from "@/lib/auth/cookie-names";

/**
 * Every auth cookie name and option lives here, so a change to SameSite or
 * lifetime happens in one place rather than in eight route handlers (AD-3).
 *
 * `at` and `rt` are httpOnly: the browser never reads a token, Zustand stores
 * only non-sensitive UI state. `csrf` is deliberately readable by JS — it is
 * the double-submit value the client echoes back in a header (SEC-1).
 */

export {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  GUEST_COOKIE,
} from "@/lib/auth/cookie-names";

/** Short by design: a stateless JWT cannot be revoked, so it must expire fast (SEC-22). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Revocation lives with the refresh token, which is a DB row we control. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const CSRF_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface CookieOptions {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number;
}

/**
 * Both `NextResponse.cookies` and the store returned by `await cookies()`
 * expose this shape, so one helper serves route handlers and server actions.
 */
export interface CookieWriter {
  set(options: CookieOptions): unknown;
  delete(name: string): unknown;
}

function isSecure(): boolean {
  return serverEnv().NODE_ENV === "production";
}

export function accessCookie(token: string): CookieOptions {
  return {
    name: ACCESS_COOKIE,
    value: token,
    httpOnly: true,
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export function refreshCookie(token: string): CookieOptions {
  return {
    name: REFRESH_COOKIE,
    value: token,
    httpOnly: true,
    secure: isSecure(),
    // Strict would drop the cookie on any cross-site navigation into the app,
    // silently logging the user out when they arrive from a payment redirect.
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  };
}

export function csrfCookie(token: string): CookieOptions {
  return {
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false, // read by the client to populate the x-csrf-token header
    secure: isSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: CSRF_TOKEN_TTL_SECONDS,
  };
}

export function setAuthCookies(
  writer: CookieWriter,
  tokens: { accessToken: string; refreshToken: string },
): void {
  writer.set(accessCookie(tokens.accessToken));
  writer.set(refreshCookie(tokens.refreshToken));
}

export function clearAuthCookies(writer: CookieWriter): void {
  writer.delete(ACCESS_COOKIE);
  writer.delete(REFRESH_COOKIE);
}
