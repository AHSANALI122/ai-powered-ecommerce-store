import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody, parseSearchParams } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireApiVerifiedUser } from "@/lib/auth/api-guard";
import { reviewListQuerySchema, submitReviewSchema } from "@/lib/validation/review";
import { listProductReviews, submitReview } from "@/server/reviews/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reviews?productId=… — a product's approved reviews.
 *
 * Public and unauthenticated, because the same rows are already rendered into
 * the product page; this endpoint exists for paging past the first page
 * without a navigation. The service filters on `status: APPROVED` in the
 * query, so there is no view of the moderation queue here to widen.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = parseSearchParams(
    request.nextUrl.searchParams,
    reviewListQuerySchema,
  );
  if (!parsed.ok) return parsed.response;

  const page = await listProductReviews(parsed.data);
  return jsonOk(page);
}

/**
 * POST /api/reviews — submit a review (F6).
 *
 * Verified email required, on the same reasoning as checkout: an unverified
 * address is an unowned one, and a review is public speech attributed to an
 * account. `verifiedPurchase` is absent from the schema and computed in the
 * service from the caller's own paid orders (SEC-4's principle applied to a
 * trust badge rather than to money).
 *
 * Two rate-limit buckets, user and IP (SEC-8, SEC-18). The user bucket is the
 * real control — reviews are per-account and a single account cannot exceed
 * one review per product anyway — and the IP bucket bounds an actor cycling
 * through freshly registered accounts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiVerifiedUser();
  if (!guard.ok) return guard.response;

  for (const identifier of [`user:${guard.user.id}`, `ip:${clientIp(request.headers)}`]) {
    const limited = await rateLimit("review:submit", identifier);
    if (!limited.success) {
      return jsonError("RATE_LIMITED", "Too many reviews. Try again later.", {
        headers: rateLimitHeaders(limited),
      });
    }
  }

  const parsed = await parseBody(request, submitReviewSchema);
  if (!parsed.ok) return parsed.response;

  const result = await submitReview(guard.user.id, parsed.data);
  if (!result.ok) {
    return result.reason === "DUPLICATE"
      ? jsonError("CONFLICT", "You have already reviewed this product.")
      : jsonError("NOT_FOUND", "That product is not available.");
  }

  // No `revalidateCatalog` here on purpose: a PENDING review changes nothing a
  // cached page displays. The invalidation belongs to moderation, which is
  // where a review becomes public and the cached rating actually moves.
  return jsonOk({ review: result.review }, { status: 201 });
}
