import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  GUEST_COOKIE,
  csrfCookie,
  guestCookie,
} from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { generateCsrfToken, isSafeMethod, isSameOriginRequest } from "@/lib/csrf";

/**
 * Security headers (SEC-15), guest identity, CSRF origin enforcement (SEC-1)
 * and coarse route protection (SEC-7).
 *
 * Next 16 renamed `middleware` to `proxy`; the runtime is Node.js and is not
 * configurable. Everything here must stay cheap — it runs on every matched
 * request — so it verifies the access token's signature (a few microseconds of
 * HMAC) and never touches the database. Real authorisation happens in the route
 * or page, against the user row; this layer only keeps obvious traffic out.
 *
 * The CSP is still F0's: permissive about inline styles because Next injects
 * them. F6 finalises it (nonce-based script-src, tightened connect-src once the
 * payment and AI origins are known).
 */

/** Signed-in only. The page still calls requireUser(); this saves a render. */
const PROTECTED_PREFIXES = ["/account", "/checkout"] as const;
/** Staff area. The page re-checks the role against the database (SEC-7). */
const STAFF_PREFIXES = ["/admin"] as const;

/**
 * Hosts the browser may be POSTed to when a hosted checkout takes over.
 * `form-action 'self'` alone would silently break the Easypaisa redirect, and
 * a CSP violation on a payment hand-off is a very expensive thing to debug.
 * Read from process.env rather than serverEnv() so a validation failure can
 * never take the proxy — and with it every security header — down.
 */
function paymentFormOrigins(): string[] {
  const origins = new Set<string>();
  for (const value of [
    process.env.EASYPAISA_CHECKOUT_URL ??
      "https://easypay.easypaisa.com.pk/easypay/Index.jsf",
    "https://checkout.stripe.com",
  ]) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* an unparseable override simply contributes nothing */
    }
  }
  return [...origins];
}

function contentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'" // Next dev overlay + HMR
    : "'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.pexels.com",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    `form-action 'self' ${paymentFormOrigins().join(" ")}`,
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, isDev: boolean): void {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy(isDev));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (!isDev) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
}

function applyIssuedCookies(request: NextRequest, response: NextResponse): void {
  // Guest cart identity (F3). Issued to everyone so an anonymous cart survives
  // navigation; it is replaced by the user's cart on login.
  if (!request.cookies.get(GUEST_COOKIE)) {
    response.cookies.set(guestCookie(crypto.randomUUID()));
  }

  // Double-submit CSRF value. Readable by JS on purpose: the client echoes it
  // in x-csrf-token, which a cross-site page cannot do (SEC-1).
  if (!request.cookies.get(CSRF_COOKIE)) {
    response.cookies.set(csrfCookie(generateCsrfToken()));
  }
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname, search } = request.nextUrl;

  const finish = (response: NextResponse): NextResponse => {
    applySecurityHeaders(response, isDev);
    applyIssuedCookies(request, response);
    return response;
  };

  // --- CSRF layer 1: strict origin on every mutation (SEC-1) ---------------
  // Webhooks are exempt and prove themselves with a provider signature or hash
  // instead (AD-8); they are unauthenticated by design and carry no cookies.
  if (!isSafeMethod(request.method) && !pathname.startsWith("/api/webhooks/")) {
    if (!isSameOriginRequest(request)) {
      return finish(
        NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Request rejected." } },
          { status: 403 },
        ),
      );
    }
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = accessToken ? await verifyAccessToken(accessToken) : null;

  // --- Silent refresh ------------------------------------------------------
  // An expired access token with a live refresh cookie should not look like a
  // logout. For document navigations only (a redirect would discard a POST
  // body), bounce through the rotation endpoint and come straight back.
  if (
    !claims &&
    request.cookies.get(REFRESH_COOKIE) &&
    isDocumentNavigation(request) &&
    !pathname.startsWith("/api/")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/api/auth/refresh";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    // Rotation clears the refresh cookie when it fails, so the next navigation
    // will not come back here: the loop terminates in one hop either way.
    return finish(NextResponse.redirect(url));
  }

  // --- Coarse route protection (SEC-7) -------------------------------------
  if (!claims && startsWithAny(pathname, [...PROTECTED_PREFIXES, ...STAFF_PREFIXES])) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return finish(NextResponse.redirect(url));
  }

  if (
    startsWithAny(pathname, STAFF_PREFIXES) &&
    claims &&
    claims.role !== "STAFF" &&
    claims.role !== "ADMIN"
  ) {
    // Not a 403: an unauthorised visitor should not learn the route exists.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return finish(NextResponse.redirect(url));
  }

  // Pass the resolved path down so a server component can build an accurate
  // ?next= for its login redirect. Set, never merged, so a client-supplied
  // x-pathname header cannot survive.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);

  return finish(NextResponse.next({ request: { headers } }));
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and common static assets.
     * Payment webhooks are matched too — they need the headers but must never
     * be given a CSRF requirement here (they authenticate by signature).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
