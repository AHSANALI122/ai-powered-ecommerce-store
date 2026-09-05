import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCsrf } from "@/lib/csrf";
import { REFRESH_COOKIE, clearAuthCookies } from "@/lib/auth/cookies";
import { revokeSessionByToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Clearing the cookies is not enough on its own: the access token stays
 * cryptographically valid until it expires, which is precisely why its TTL is
 * 15 minutes (SEC-22). Revocation is done where it can be done — the refresh
 * family in the database.
 *
 * Always 200. Logging out something that was already logged out is a success.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await revokeSessionByToken(refreshToken);
    } catch (error) {
      // The cookies still get cleared; a failed revoke is a logged incident,
      // not a reason to leave the user apparently signed in.
      console.error("[auth/logout]", error);
    }
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response.cookies);
  return response;
}
