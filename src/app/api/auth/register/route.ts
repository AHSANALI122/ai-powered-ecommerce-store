import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { registerSchema } from "@/lib/validation/auth";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireCsrf } from "@/lib/csrf";
import { registerUser } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register
 *
 * Always answers 200 with the same body, whether the address was free or
 * already registered (SEC-9). The account either exists now or already did;
 * either way the next step for a legitimate user is the same — check your mail.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const limited = await rateLimit("auth:register", clientIp(request.headers));
  if (!limited.success) {
    return jsonError("RATE_LIMITED", "Too many attempts. Try again later.", {
      headers: rateLimitHeaders(limited),
    });
  }

  const parsed = await parseBody(request, registerSchema);
  if (!parsed.ok) return parsed.response;

  try {
    await registerUser(parsed.data);
  } catch (error) {
    console.error("[auth/register]", error);
    return jsonError("INTERNAL", "Could not complete registration.");
  }

  return jsonOk({
    ok: true,
    message: "Check your inbox for a link to confirm your email address.",
  });
}
