import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { startPasswordReset } from "@/server/auth/service";
import { hashToken } from "@/lib/auth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot-password
 *
 * Answers the same 200 for a registered and an unregistered address (SEC-9).
 * Limited per IP and per account so this endpoint cannot be turned into a mail
 * bomb aimed at one inbox (SEC-8).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const byIp = await rateLimit("auth:reset", `ip:${clientIp(request.headers)}`);
  if (!byIp.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(byIp),
    });
  }

  const parsed = await parseBody(request, forgotPasswordSchema);
  if (!parsed.ok) return parsed.response;

  const byAccount = await rateLimit("auth:reset", `acct:${hashToken(parsed.data.email)}`);
  if (byAccount.success) {
    try {
      await startPasswordReset(parsed.data.email);
    } catch (error) {
      console.error("[auth/forgot-password]", error);
    }
  }

  // Note the shape: even a throttled account gets the ordinary success body,
  // because a different response would itself confirm the address exists.
  return jsonOk({
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  });
}
