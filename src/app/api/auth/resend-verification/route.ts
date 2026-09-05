import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { resendVerificationSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { resendVerification } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/resend-verification — generic response, always (SEC-9). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const limited = await rateLimit("auth:reset", clientIp(request.headers));
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const parsed = await parseBody(request, resendVerificationSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await resendVerification(parsed.data.email);
  } catch (error) {
    console.error("[auth/resend-verification]", error);
  }

  return jsonOk({
    ok: true,
    message: "If that address needs confirming, a new link is on its way.",
  });
}
