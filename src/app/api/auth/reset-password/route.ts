import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { completePasswordReset } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset-password
 *
 * On success every session for that user is revoked (SEC-10) — including the
 * caller's own, which is why the cookies are cleared here and the user is sent
 * to the login page. A reset that left an attacker's session alive would be
 * theatre.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const limited = await rateLimit("auth:reset", `ip:${clientIp(request.headers)}`);
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const parsed = await parseBody(request, resetPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const result = await completePasswordReset(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return jsonError("UNPROCESSABLE", "This link is no longer valid. Request a new one.");
  }

  const response = jsonOk({
    ok: true,
    message: "Password updated. Sign in with your new password.",
  });
  clearAuthCookies(response.cookies);
  return response;
}
