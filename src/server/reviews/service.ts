import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ReviewStatus } from "@/generated/prisma/enums";
import { recomputeProductRating } from "@/server/admin/reviews";
import { CATALOG_REVALIDATE_SECONDS, cacheTags } from "@/lib/cache-tags";
import { REVIEW_PAGE_SIZE_DEFAULT } from "@/lib/validation/review";
import type {
  ReviewListQuery,
  SubmitReviewInput,
  UpdateReviewInput,
} from "@/lib/validation/review";

/**
 * Customer-facing review service (F6).
 *
 * Three invariants live here rather than in the route handler, because the
 * route is only one caller and the rules are about the data, not the HTTP:
 *
 *  1. **`verifiedPurchase` is computed, never claimed.** The submit schema has
 *     no such field, and this module derives it from the caller's own paid
 *     orders. That is the whole difference between a trust signal and a
 *     checkbox anybody can tick.
 *  2. **A review starts PENDING and returns to PENDING when edited.** An
 *     approved review whose text can be swapped afterwards is a moderation
 *     bypass with extra steps, so an edit re-enters the queue.
 *  3. **Every write that can change what is APPROVED recomputes the cached
 *     rating in the same transaction**, through the single implementation in
 *     `@/server/admin/reviews`. Two recompute implementations is how the two
 *     numbers begin to disagree.
 */

/**
 * Order states that earn the badge.
 *
 * `paymentStatus: PAID` is the money half and the order status is the
 * lifecycle half; both must hold. A REFUNDED or CANCELLED order fails on
 * status even though it once had `paidAt`, which is exactly the spec's
 * "refunded/cancelled do not grant it" — the shopper no longer owns the thing
 * they are reviewing.
 */
const PURCHASED_ORDER_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED"] as const;

function purchasedWhere(userId: string, productId: string): Prisma.OrderWhereInput {
  return {
    userId,
    paymentStatus: "PAID",
    status: { in: [...PURCHASED_ORDER_STATUSES] },
    items: { some: { productId } },
  };
}

/**
 * Did this user actually buy this product?
 *
 * Matched on `OrderItem.productId` rather than on the title snapshot: the
 * snapshot exists so history does not move when the catalogue is edited, and
 * it is deliberately not an identity. `productId` is nullable (deleting a
 * product sets it null), and a null never equals the id we pass, so a purchase
 * of a since-deleted product simply stops proving anything — the safe way for
 * this to fail.
 */
export async function hasPurchased(userId: string, productId: string): Promise<boolean> {
  const count = await prisma.order.count({ where: purchasedWhere(userId, productId) });
  return count > 0;
}

/** The same question against a transaction client, for use inside one. */
async function hasPurchasedInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  productId: string,
): Promise<boolean> {
  const count = await tx.order.count({ where: purchasedWhere(userId, productId) });
  return count > 0;
}

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  verifiedPurchase: boolean;
  createdAt: Date;
  /** First name only — a full name on a public page is needless PII (SEC-25). */
  authorName: string;
}

export interface ReviewPage {
  reviews: PublicReview[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Count per star, 1..5, over APPROVED rows. Drives the histogram. */
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

const REVIEW_ORDER_BY: Record<
  ReviewListQuery["sort"],
  Prisma.ReviewOrderByWithRelationInput[]
> = {
  newest: [{ createdAt: "desc" }],
  // Ties broken by recency so the order is total and pagination is stable —
  // without it a row can appear on two pages or on none.
  "rating-desc": [{ rating: "desc" }, { createdAt: "desc" }],
  "rating-asc": [{ rating: "asc" }, { createdAt: "desc" }],
};

/** Public display name. Never the email, and never the surname. */
function displayName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "Anonymous";
}

/**
 * A product's APPROVED reviews. PENDING and REJECTED rows are excluded in the
 * `where`, not filtered afterwards — the same rule as ownership scoping
 * (SEC-23): a row that must not be shown should never be fetched.
 */
export async function listProductReviews(query: ReviewListQuery): Promise<ReviewPage> {
  const where: Prisma.ReviewWhereInput = {
    productId: query.productId,
    status: "APPROVED",
  };

  const [rows, total, grouped] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: REVIEW_ORDER_BY[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        verifiedPurchase: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.review.count({ where }),
    prisma.review.groupBy({ by: ["rating"], where, _count: { _all: true } }),
  ]);

  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const group of grouped) {
    const star = group.rating as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) breakdown[star] = group._count._all;
  }

  return {
    reviews: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      verifiedPurchase: row.verifiedPurchase,
      createdAt: row.createdAt,
      authorName: displayName(row.user.name),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    breakdown,
  };
}

/**
 * The first page of a product's reviews, cached under the product's own tag
 * (SEC-11).
 *
 * This exists so the product page can render reviews **without reading a
 * cookie**. That is not a caching nicety: `cookies()` anywhere in a route —
 * even inside a Suspense boundary — opts the whole route out of static
 * rendering, and `/p/[slug]` is prerendered from `generateStaticParams`. A
 * reviews block that called `getCurrentUser()` would quietly turn every
 * product page dynamic and give back the LCP that F2 bought (spec §7).
 *
 * So the split is: this read is anonymous and cached, and everything about
 * *the caller* — their own review, whether they saved the product — is fetched
 * by the client after hydration.
 *
 * The cache is built per call rather than at module scope because the tag
 * depends on the argument, which is the same reason `getProductBySlug` does
 * it. The tag is the product's, and F4's moderation path already invalidates
 * it through `revalidateCatalog(slug)` — so approving a review republishes
 * this list at the same moment it moves the star rating.
 */
export async function listProductReviewsCached(
  productId: string,
  slug: string,
): Promise<ReviewPage> {
  return unstable_cache(
    (id: string) =>
      listProductReviews({
        productId: id,
        page: 1,
        pageSize: REVIEW_PAGE_SIZE_DEFAULT,
        sort: "newest",
      }),
    ["reviews", "product"],
    {
      revalidate: CATALOG_REVALIDATE_SECONDS,
      tags: [cacheTags.catalog, cacheTags.product(slug)],
    },
  )(productId);
}

export interface OwnReview {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: Date;
}

const OWN_REVIEW_SELECT = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  body: true,
  status: true,
  verifiedPurchase: true,
  createdAt: true,
} as const;

/**
 * The caller's own review of one product, in any status.
 *
 * Owner-scoped in the `where` (SEC-23), and it is what lets the form say
 * "awaiting moderation" instead of pretending nothing was submitted — the
 * unique constraint would otherwise surface as an unexplained conflict.
 */
export async function getOwnReview(
  userId: string,
  productId: string,
): Promise<OwnReview | null> {
  return prisma.review.findUnique({
    where: { productId_userId: { productId, userId } },
    select: OWN_REVIEW_SELECT,
  });
}

export type ReviewWriteResult =
  | { ok: true; review: OwnReview }
  | { ok: false; reason: "NOT_FOUND" | "DUPLICATE" };

/**
 * Submits a review.
 *
 * Rating aggregates are *not* touched: a PENDING review is not public and must
 * not move the stars, which is what stops the depth of the moderation queue
 * from being readable off a product page.
 *
 * The `@@unique([productId, userId])` violation is caught rather than
 * pre-checked. A findFirst-then-create has a window between the two in which a
 * double-clicked form creates two rows; letting the database arbitrate is the
 * only version that is correct under concurrency.
 */
export async function submitReview(
  userId: string,
  input: SubmitReviewInput,
): Promise<ReviewWriteResult> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, isActive: true },
    select: { id: true },
  });
  // The same answer for "no such product" and "hidden product": a review form
  // must not become a probe for unpublished catalogue rows.
  if (!product) return { ok: false, reason: "NOT_FOUND" };

  const verifiedPurchase = await hasPurchased(userId, product.id);

  try {
    const review = await prisma.review.create({
      data: {
        productId: product.id,
        userId,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        verifiedPurchase,
        status: "PENDING",
      },
      select: OWN_REVIEW_SELECT,
    });
    return { ok: true, review };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

/**
 * Edits the caller's own review, returning it to moderation.
 *
 * Wrapped in a transaction with a recompute because the row may currently be
 * APPROVED and counted: dropping back to PENDING must remove it from the
 * average in the same instant it stops being public. The owner appears in the
 * `where` of the write itself — a `findUnique` then `update` would authorise
 * on a value read a moment earlier (SEC-23).
 */
export async function updateOwnReview(
  userId: string,
  reviewId: string,
  input: UpdateReviewInput,
): Promise<ReviewWriteResult> {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, productId: true },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND" };

  const review = await prisma.$transaction(async (tx) => {
    // Recomputed on every edit rather than copied forward: the shopper may
    // have bought the product since writing, and the badge should not be
    // frozen at whatever was true at first submit.
    const verifiedPurchase = await hasPurchasedInTx(tx, userId, existing.productId);

    const changed = await tx.review.updateMany({
      where: { id: reviewId, userId },
      data: {
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        // Re-moderated. An edit after approval is otherwise a way to publish
        // text no moderator ever read.
        status: "PENDING",
        verifiedPurchase,
      },
    });
    if (changed.count === 0) return null;

    await recomputeProductRating(tx, existing.productId);

    return tx.review.findUnique({ where: { id: reviewId }, select: OWN_REVIEW_SELECT });
  });

  if (!review) return { ok: false, reason: "NOT_FOUND" };
  return { ok: true, review };
}

/**
 * Deletes the caller's own review and recomputes the product's rating in the
 * same transaction, so a deleted 1-star cannot linger in the average.
 */
export async function deleteOwnReview(
  userId: string,
  reviewId: string,
): Promise<{ ok: boolean }> {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { productId: true },
  });
  if (!existing) return { ok: false };

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.review.deleteMany({ where: { id: reviewId, userId } });
    if (deleted.count === 0) return { ok: false };
    await recomputeProductRating(tx, existing.productId);
    return { ok: true };
  });
}
