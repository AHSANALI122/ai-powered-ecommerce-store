import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/csrf";
import {
  REFRESH_COOKIE,
  accessCookie,
  clearAuthCookies,
  refreshCookie,
} from "@/lib/auth/cookies";
import { rotateRefreshToken } from "@/lib/auth/session";
import { signAccessToken } from "@/lib/auth/tokens";
import { publicUser } from "@/server/auth/service";
import { safeRelativePath } from "@/lib/safe-redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh-token rotation with reuse detection (SEC-21).
 *
 * Two entry points, one implementation:
 *
 *  - **POST** — called by client code after a 401. Answers JSON.
 *  - **GET**  — called by the proxy for a document navigation whose access
 *    token has expired, so a signed-in user does not get bounced to the login
 *    page every 15 minutes. Answers a redirect back to where they were going.
 *
 * The double-submit CSRF token is deliberately not required here. The GET form
 * is a top-level navigation that cannot carry a custom header, and the
 * operation is not a state change the user could be tricked into: the worst a
 * forced refresh does is rotate the caller's own token. The strict same-origin
 * check still applies to the POST form.
 */

interface RotationOutcome {
  status: "ok" | "unauthenticated";
  apply: (response: NextResponse) => void;
  body: Record<string, unknown>;
}

async function rotate(request: NextRequest): Promise<RotationOutcome> {
  const presented = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!presented) {
    return {
      status: "unauthenticated",
      apply: (response) => clearAuthCookies(response.cookies),
      body: { ok: false },
    };
  }

  const result = await rotateRefreshToken(presented, {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request.headers),
  });

  if (!result.ok) {
    if (result.reason === "reused") {
      // The whole family was just revoked. Log it: a replayed refresh token is
      // the clearest signal of token theft this system produces.
      console.warn("[auth/refresh] refresh token replay detected; family revoked");
    }
    return {
      status: "unauthenticated",
      apply: (response) => clearAuthCookies(response.cookies),
      body: { ok: false },
    };
  }

  // Role and verification state are re-read here rather than copied from the
  // old token, so a demotion or a just-completed verification is reflected at
  // most one access-token lifetime later.
  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  if (!user) {
    return {
      status: "unauthenticated",
      apply: (response) => clearAuthCookies(response.cookies),
      body: { ok: false },
    };
  }

  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    ev: user.emailVerified !== null,
    fam: result.familyId,
  });

  return {
    status: "ok",
    apply: (response) => {
      response.cookies.set(accessCookie(accessToken));
      response.cookies.set(refreshCookie(result.token));
    },
    body: { ok: true, user: publicUser(user) },
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonError("FORBIDDEN", "Request rejected.");
  }

  const limited = await rateLimit("auth:refresh", clientIp(request.headers));
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const outcome = await rotate(request);
  if (outcome.status === "unauthenticated") {
    const response = jsonError("UNAUTHORIZED", "Session expired.");
    outcome.apply(response);
    return response;
  }

  const response = NextResponse.json(outcome.body);
  outcome.apply(response);
  return response;
}

/** Silent refresh for navigations. Always redirects; never leaks a reason. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = safeRelativePath(request.nextUrl.searchParams.get("next"), "/");
  const target = new URL(next, request.nextUrl.origin);

  const limited = await rateLimit("auth:refresh", clientIp(request.headers));
  if (!limited.success) {
    const response = NextResponse.redirect(target);
    clearAuthCookies(response.cookies);
    return response;
  }

  const outcome = await rotate(request);
  // On failure the refresh cookie is cleared, so the proxy will not send the
  // next navigation back here — that is what stops a redirect loop.
  const response = NextResponse.redirect(target);
  outcome.apply(response);
  return response;
}
