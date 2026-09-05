import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ReviewStatus } from "@/generated/prisma/enums";
import { paged, paginate, type Paged } from "@/lib/validation/admin/list";
import type { ReviewListQuery } from "@/lib/validation/admin/operations";
import { revalidateCatalog } from "@/server/admin/revalidate";
import type { WriteResult } from "@/server/admin/products";

/**
 * Review moderation and the cached-rating recompute (F4 → F6).
 *
 * `Product.ratingAvg` / `ratingCount` are denormalised aggregates, which means
 * they can drift, and a rating is exactly the number nobody notices is wrong.
 * Two rules keep them honest:
 *
 *  1. **Recompute, never adjust.** The aggregate is derived from a fresh
 *     `groupBy` over the APPROVED rows, not from nudging the old value by the
 *     delta of the review being moderated. An incremental update is correct
 *     only if every prior update was, and one missed edge — a re-approval, a
 *     double click, a moderator flipping a verdict twice — makes it permanently
 *     wrong with nothing to notice it by.
 *  2. **Same transaction as the verdict.** A crash between "approved" and
 *     "counted" would leave a 5-star review that no rating reflects. Writing
 *     both atomically means the cached number is a pure function of committed
 *     rows at every instant an observer could look.
 *
 * Only APPROVED reviews count. A PENDING review is not yet public and a
 * REJECTED one never will be, so neither may move the average — which is what
 * stops moderation queue depth from being visible in a product's stars.
 */

export interface AdminReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: Date;
  productId: string;
  productTitle: string;
  productSlug: string;
  authorName: string | null;
  authorEmail: string;
}

const ORDER_BY: Record<
  ReviewListQuery["sort"],
  (dir: "asc" | "desc") => Prisma.ReviewOrderByWithRelationInput
> = {
  createdAt: (dir) => ({ createdAt: dir }),
  rating: (dir) => ({ rating: dir }),
};

export async function listAdminReviews(
  query: ReviewListQuery,
): Promise<Paged<AdminReviewRow>> {
  const where: Prisma.ReviewWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.q
      ? {
          OR: [
            { body: { contains: query.q, mode: "insensitive" as const } },
            { title: { contains: query.q, mode: "insensitive" as const } },
            { product: { title: { contains: query.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: ORDER_BY[query.sort](query.dir),
      ...paginate(query),
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        status: true,
        verifiedPurchase: true,
        createdAt: true,
        product: { select: { id: true, title: true, slug: true } },
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return paged(
    rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      verifiedPurchase: row.verifiedPurchase,
      createdAt: row.createdAt,
      productId: row.product.id,
      productTitle: row.product.title,
      productSlug: row.product.slug,
      authorName: row.user.name,
      authorEmail: row.user.email,
    })),
    total,
    query,
  );
}

/**
 * Recomputes a product's cached rating from its APPROVED reviews.
 *
 * Exported because F6's review submission and deletion paths need the identical
 * recompute — having two implementations of this is how the two numbers start
 * disagreeing. Takes a transaction client so the caller decides the atomicity
 * boundary; it must always be called inside one.
 */
export async function recomputeProductRating(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<{ ratingAvg: string; ratingCount: number }> {
  const aggregate = await tx.review.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const count = aggregate._count._all;
  // `_avg` is a float over a small integer column, and the target is
  // Decimal(3,2) — quantise here rather than letting Prisma round it.
  const average = count === 0 ? "0.00" : (aggregate._avg.rating ?? 0).toFixed(2);

  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg: average, ratingCount: count },
  });

  return { ratingAvg: average, ratingCount: count };
}

export interface ModerationResult {
  id: string;
  status: ReviewStatus;
  productId: string;
  productSlug: string;
  ratingAvg: string;
  ratingCount: number;
}

export async function moderateReview(
  reviewId: string,
  status: ReviewStatus,
): Promise<WriteResult<ModerationResult>> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, productId: true, product: { select: { slug: true } } },
  });
  if (!review) return { ok: false, reason: "NOT_FOUND", message: "Review not found." };

  const result = await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id: reviewId }, data: { status } });
    return recomputeProductRating(tx, review.productId);
  });

  // The product page shows the star rating, so the cached page is now wrong.
  revalidateCatalog([review.product.slug]);

  return {
    ok: true,
    value: {
      id: review.id,
      status,
      productId: review.productId,
      productSlug: review.product.slug,
      ratingAvg: result.ratingAvg,
      ratingCount: result.ratingCount,
    },
  };
}
