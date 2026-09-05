import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiVerifiedUser } from "@/lib/auth/api-guard";
import { updateReviewSchema } from "@/lib/validation/review";
import { deleteOwnReview, updateOwnReview } from "@/server/reviews/service";
import { revalidateCatalog } from "@/server/admin/revalidate";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH / DELETE /api/reviews/[id] — the author's own review.
 *
 * Both service calls carry `userId` in the `where` of the write itself, so an
 * id belonging to somebody else is indistinguishable from one that does not
 * exist (SEC-23), which is what the identical 404 below reports. There is no
 * `status` field to send: moderation is a STAFF capability under `/api/admin`,
 * and an edit here returns the row to PENDING regardless of what it was.
 */

/**
 * The slug is needed to invalidate the product page, and it is read *after*
 * the ownership-scoped write has already succeeded — so this lookup can never
 * be the thing that decides access. It is a cache concern, not an authz one.
 */
async function revalidateProduct(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });
  revalidateCatalog([product?.slug]);
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/reviews/[id]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiVerifiedUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, updateReviewSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await updateOwnReview(guard.user.id, id, parsed.data);
  if (!result.ok) return jsonError("NOT_FOUND", "Review not found.");

  // An edit can un-approve a counted review, which moves the cached rating —
  // so unlike submission, this one does invalidate the product page.
  await revalidateProduct(result.review.productId);

  return jsonOk({ review: result.review });
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/reviews/[id]">,
): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiVerifiedUser();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  // Read the product before the row is gone; the delete is still what
  // authorises, and a wrong guess here only costs a needless invalidation.
  const owned = await prisma.review.findFirst({
    where: { id, userId: guard.user.id },
    select: { productId: true },
  });

  const removed = await deleteOwnReview(guard.user.id, id);
  if (!removed.ok) return jsonError("NOT_FOUND", "Review not found.");

  if (owned) await revalidateProduct(owned.productId);

  return jsonOk({ ok: true });
}
