import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseSearchParams } from "@/lib/http";
import { requireAdminRead } from "@/server/admin/guard";
import { reviewListSchema } from "@/lib/validation/admin/operations";
import { listAdminReviews } from "@/server/admin/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/reviews
 *
 * Review bodies are shopper-authored text. They are returned as data and
 * rendered as text — never as markup, and never interpreted — which is the same
 * rule F5's tools will need when retrieved review text reaches the model
 * (SEC-2). A moderation queue is the first place that text is read by someone
 * with privileges, so it is the first place the rule has to hold.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const parsed = parseSearchParams(request.nextUrl.searchParams, reviewListSchema);
  if (!parsed.ok) return parsed.response;

  return jsonOk(await listAdminReviews(parsed.data));
}
