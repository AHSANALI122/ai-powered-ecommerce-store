import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/http";
import { loginSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { authenticate, establishSession, publicUser } from "@/server/auth/service";
import { hashToken } from "@/lib/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 *
 * Throttled on two axes (SEC-8): by IP, which stops one host spraying many
 * accounts, and by account, which stops a botnet grinding one account from
 * many hosts. The account key is hashed so the limiter store never holds a
 * list of the site's email addresses.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const ip = clientIp(request.headers);
  const byIp = await rateLimit("auth:login", `ip:${ip}`);
  if (!byIp.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(byIp),
    });
  }

  const parsed = await parseBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;

  const byAccount = await rateLimit("auth:login", `acct:${hashToken(parsed.data.email)}`);
  if (!byAccount.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(byAccount),
    });
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    // One message for both failure modes: no account, and wrong password.
    return jsonError("UNAUTHORIZED", "Email or password is incorrect.");
  }

  const response = NextResponse.json({
    ok: true,
    user: publicUser(user),
  });

  await establishSession(response.cookies, user, {
    userAgent: request.headers.get("user-agent"),
    ip,
  });

  // F3 hooks the guest-cart merge in here: the guestId cookie is still on the
  // request at this point, and the user id has just been established.

  return response;
}
