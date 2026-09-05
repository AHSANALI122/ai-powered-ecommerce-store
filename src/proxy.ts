import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers (SEC-15) and guest identity.
 *
 * Next 16 renamed `middleware` to `proxy`; the runtime is Node.js and is not
 * configurable. Everything here must stay cheap — it runs on every matched
 * request.
 *
 * This is the F0 stub: the header set is real, but the CSP is deliberately
 * permissive about inline styles because Next injects them. F6 finalises it
 * (nonce-based script-src, tightened connect-src once the payment and AI
 * origins are known).
 */

export const GUEST_COOKIE = "guestId";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

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
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const isDev = process.env.NODE_ENV !== "production";

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

  // Guest cart identity (F3). Issued to everyone so an anonymous cart survives
  // navigation; it is replaced by the user's cart on login.
  if (!request.cookies.get(GUEST_COOKIE)) {
    response.cookies.set({
      name: GUEST_COOKIE,
      value: crypto.randomUUID(),
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }

  return response;
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
