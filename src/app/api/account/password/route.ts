import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { changePasswordSchema } from "@/lib/validation/auth";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { changePassword } from "@/server/auth/service";
import { clearAuthCookies } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/password
 *
 * Requires the current password even though the caller is already signed in:
 * an unattended session is the cheapest way to take an account over
 * permanently, and this is the step that stops it.
 *
 * Succeeding revokes every session including this one (SEC-10), so the caller
 * is signed out and must re-authenticate with the new password.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const limited = await rateLimit("auth:reset", `user:${guard.user.id}`);
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const parsed = await parseBody(request, changePasswordSchema);
  if (!parsed.ok) return parsed.response;

  const changed = await changePassword(
    guard.user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );

  if (!changed) {
    return jsonError("UNAUTHORIZED", "Current password is incorrect.");
  }

  const response = jsonOk({
    ok: true,
    message: "Password updated. Sign in again with your new password.",
  });
  clearAuthCookies(response.cookies);
  return response;
}
