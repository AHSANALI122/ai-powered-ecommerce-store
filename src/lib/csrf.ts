import type { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/cookie-names";
import { safeEqual } from "@/lib/auth/tokens";
import { jsonError } from "@/lib/http";
import { serverEnv } from "@/lib/env";
import type { NextResponse } from "next/server";

/**
 * CSRF defence (SEC-1), two independent layers:
 *
 *  1. **Origin / Sec-Fetch-Site.** A cross-site form post either omits `Origin`
 *     for navigations or carries a foreign one; either way it fails here. The
 *     proxy applies this to every mutation, including Server Actions.
 *  2. **Double-submit token.** A random value is set in a JS-readable cookie
 *     and must be echoed in `x-csrf-token`. An attacker's page can make the
 *     browser send the cookie but cannot read it to set the header.
 *
 * SameSite=Lax alone is not enough: it still permits top-level cross-site POST
 * navigation in some browsers, and it is one browser-default change away from
 * not being a control at all.
 */

export { CSRF_HEADER } from "@/lib/auth/cookie-names";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hosts a mutation may legitimately originate from. */
function allowedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();
  const configured = serverEnv().APP_URL;
  try {
    origins.add(new URL(configured).origin);
  } catch {
    /* APP_URL is validated as a URL at boot; ignore defensively */
  }
  // Behind a proxy the request URL host is the deployment host, which is the
  // origin the browser actually used.
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) origins.add(`${proto}://${forwardedHost}`);
  origins.add(new URL(request.url).origin);
  return origins;
}

/**
 * Layer 1. Returns true when the request demonstrably comes from this site.
 * A request with neither `Origin` nor `Sec-Fetch-Site` is rejected: every
 * browser that can perform a cross-site mutation sends at least one of them.
 */
export function isSameOriginRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return true;
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const origin = request.headers.get("origin");
  if (origin) return allowedOrigins(request).has(origin);

  return false;
}

/** Layer 2. Cookie value must equal the header value, compared in constant time. */
export function hasValidCsrfToken(request: NextRequest): boolean {
  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}

/**
 * Both layers, for use at the top of every cookie-authenticated route handler.
 * Returns a 403 response to return, or null when the request may proceed.
 *
 * Payment webhooks must NOT call this — they are unauthenticated by design and
 * prove themselves with a provider signature or hash instead (AD-8).
 */
export function requireCsrf(request: NextRequest): NextResponse | null {
  if (isSafeMethod(request.method)) return null;
  if (!isSameOriginRequest(request) || !hasValidCsrfToken(request)) {
    return jsonError("FORBIDDEN", "Request rejected.");
  }
  return null;
}
