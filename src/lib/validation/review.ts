import { z } from "zod";
import { idSchema } from "@/lib/validation/cart";

/**
 * Review input schemas (SEC-16, F6).
 *
 * What is absent is again the point. There is no `verifiedPurchase`, no
 * `status`, no `userId` and no `createdAt`: a shopper states a rating and
 * writes prose, and every field that carries authority is derived on the
 * server. `.strict()` is what makes that a rejection rather than a silently
 * ignored key — a body claiming `verifiedPurchase: true` fails at the
 * boundary instead of reaching a spread into `prisma.review.create`.
 *
 * The length bounds are not cosmetic either: an unbounded `body` is a cheap
 * way to fill a table, and this text is later fenced into an LLM's context by
 * F5's tools, where its size is a cost.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_TITLE_MAX = 120;

export const ratingSchema = z.coerce.number().int().min(RATING_MIN).max(RATING_MAX);

export const submitReviewSchema = z
  .object({
    productId: idSchema,
    rating: ratingSchema,
    /** Optional headline. Empty string means "no title", not a title of "". */
    title: z
      .string()
      .trim()
      .max(REVIEW_TITLE_MAX)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
    body: z.string().trim().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX),
  })
  .strict();

/**
 * Editing keeps the product and the author fixed — those identify the row,
 * which is why neither appears here. An edit returns the review to moderation
 * server-side; the client cannot ask to stay approved.
 */
export const updateReviewSchema = z
  .object({
    rating: ratingSchema,
    title: z
      .string()
      .trim()
      .max(REVIEW_TITLE_MAX)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional(),
    body: z.string().trim().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX),
  })
  .strict();

/** Public listing of a product's approved reviews. Sort is an opaque token. */
export const REVIEW_SORT_KEYS = ["newest", "rating-desc", "rating-asc"] as const;
export type ReviewSortKey = (typeof REVIEW_SORT_KEYS)[number];

export const REVIEW_PAGE_SIZE_DEFAULT = 10;
export const REVIEW_PAGE_SIZE_MAX = 25;
export const REVIEW_PAGE_MAX = 100;

export const reviewListQuerySchema = z
  .object({
    productId: idSchema,
    page: z.coerce.number().int().min(1).max(REVIEW_PAGE_MAX).catch(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(REVIEW_PAGE_SIZE_MAX)
      .catch(REVIEW_PAGE_SIZE_DEFAULT),
    sort: z.enum(REVIEW_SORT_KEYS).catch("newest"),
  })
  .strip();

export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

/**
 * A review as it reaches the browser.
 *
 * Identical to the server's `OwnReview` except that `createdAt` is a string:
 * it crossed a JSON boundary, and `Date` does not survive one. Typing the
 * client's copy as `Date` compiles and then lies — the first `.toISOString()`
 * on it is a runtime crash. This is the honest shape, and it lives here
 * because this module has no server imports and a client component may hold
 * it.
 */
export interface SerializedReview {
  id: string;
  productId: string;
  rating: number;
  title: string | null;
  body: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verifiedPurchase: boolean;
  createdAt: string;
}
