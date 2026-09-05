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
 * **The CSP, finalised (F6, SEC-15).** The one decision worth recording is why
 * `script-src` still carries `'unsafe-inline'`, because both alternatives were
 * tried and both cost more than they buy:
 *
 *  - **Nonces** are the textbook answer, and Next supports them — but a nonce
 *    is per-request, so using one forces every page to render dynamically.
 *    That would disable `generateStaticParams`, ISR and CDN caching across the
 *    whole catalogue, which is the architecture F2 exists to provide and the
 *    Core Web Vitals the NFRs ask for. Trading the storefront's performance
 *    for a directive is not a good trade on a catalogue of public product
 *    pages.
 *  - **Subresource Integrity** (`experimental.sri`) promises a strict
 *    `script-src` while keeping static rendering. Measured on this app's build
 *    it does not deliver one: it adds `integrity` to most chunks but not all,
 *    and it cannot cover the three inline bootstrap scripts React and Next
 *    emit to stream the flight payload — which are exactly what
 *    `'unsafe-inline'` is there for. Partial integrity plus an experimental
 *    flag on a payment-handling app is not worth an unchanged directive.
 *
 * So `script-src` stays as it is, and everything reachable *from* an injected
 * script is closed instead: `connect-src 'self'` (the assistant streams
 * through our own route, so no AI origin is needed), `object-src`,
 * `frame-src`, `worker-src` and `base-uri` are all locked down, and
 * `form-action` names the payment hosts explicitly. That is the half of the
 * defence an inline-script allowance does not weaken.
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
    // `blob:` is the URL scheme, unrelated to Vercel Blob; the explicit host is
    // where F4's admin uploads live when IMAGE_STORE=blob.
    "img-src 'self' data: blob: https://images.pexels.com https://*.public.blob.vercel-storage.com",
    "font-src 'self' data:",
    // The assistant streams through /api/assistant/chat, so the browser never
    // talks to Google directly and no AI origin belongs here.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "manifest-src 'self'",
    // Next may instantiate a worker from a blob URL; nothing else may.
    "worker-src 'self' blob:",
    // Nothing in this application embeds a frame. A payment hand-off is a
    // top-level redirect, which `form-action` below covers instead.
    "frame-src 'none'",
    "child-src 'none'",
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
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  // A cross-origin window opened from here cannot reach back into this one,
  // and this document is not readable by one that embeds it.
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  // No speculative DNS for hosts a page happens to mention.
  response.headers.set("X-DNS-Prefetch-Control", "off");
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
