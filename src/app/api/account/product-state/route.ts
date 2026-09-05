import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonOk, parseSearchParams } from "@/lib/http";
import { requireApiUser } from "@/lib/auth/api-guard";
import { idSchema } from "@/lib/validation/cart";
import { getOwnReview } from "@/server/reviews/service";
import type { SerializedReview } from "@/lib/validation/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/product-state?productId=… — what *this* shopper has on one
 * product: their own review in any status, and whether it is on their
 * wishlist.
 *
 * It exists because of a rendering constraint, not a data one. `/p/[slug]` is
 * prerendered, and anything that reads a cookie during its render — even deep
 * inside a Suspense boundary — makes the whole route dynamic. So the page
 * renders the anonymous, cacheable half, and the two personal widgets ask this
 * endpoint for their state after hydration. The page stays static; the
 * shopper still sees their own review.
 *
 * Both reads are owner-scoped in the `where` (SEC-23), and nothing here is
 * about another user — there is no id parameter that could name one.
 *
 * A guest gets a 401, which the client reads as "signed out" rather than as an
 * error. That is deliberate: a public endpoint answering "is this on your
 * wishlist" for nobody in particular has no meaning.
 */

const querySchema = z.object({ productId: idSchema }).strip();

export interface ProductStateResponse {
  wishlisted: boolean;
  /** Serialized: `createdAt` is a string by the time a browser holds it. */
  review: SerializedReview | null;
  emailVerified: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = parseSearchParams(request.nextUrl.searchParams, querySchema);
  if (!parsed.ok) return parsed.response;

  const { productId } = parsed.data;

  const [saved, review] = await Promise.all([
    prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: guard.user.id, productId } },
      select: { id: true },
    }),
    getOwnReview(guard.user.id, productId),
  ]);

  return jsonOk<ProductStateResponse>({
    wishlisted: saved !== null,
    review: review === null ? null : { ...review, createdAt: review.createdAt.toISOString() },
    emailVerified: guard.user.emailVerified !== null,
  });
}
