import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { verifyEmailSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { verifyEmail } from "@/server/auth/service";
import { signAccessToken } from "@/lib/auth/tokens";
import { accessCookie } from "@/lib/auth/cookies";
import { getSessionClaims } from "@/lib/auth/current-user";
import { publicUser } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-email
 *
 * The token is single-use and consumed inside the service (SEC-10). A failure
 * says only that the link is no longer usable — distinguishing "never existed"
 * from "already used" would confirm that a guessed token had once been valid.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const limited = await rateLimit("auth:reset", clientIp(request.headers));
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const parsed = await parseBody(request, verifyEmailSchema);
  if (!parsed.ok) return parsed.response;

  const result = await verifyEmail(parsed.data.token);
  if (!result.ok) {
    return jsonError("UNPROCESSABLE", "This link is no longer valid. Request a new one.");
  }

  const response = jsonOk({ ok: true, user: publicUser(result.user) });

  // If the person following the link is the signed-in user, refresh their
  // access token so the `ev` claim flips immediately instead of at the next
  // rotation — otherwise they would verify and still be told to verify.
  const claims = await getSessionClaims();
  if (claims && claims.sub === result.user.id) {
    const accessToken = await signAccessToken({
      sub: result.user.id,
      role: result.user.role,
      ev: true,
      fam: claims.fam,
    });
    response.cookies.set(accessCookie(accessToken));
  }

  return response;
}
