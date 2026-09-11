import { listProductReviewsCached } from "@/server/reviews/service";
import { RatingBreakdown, Stars } from "@/components/reviews/stars";
import { ProductPersonal } from "@/components/product/product-personal";

/**
 * The reviews block on a product page (F6).
 *
 * A server component that reads **no cookie**. That is the whole shape of this
 * file: `/p/[slug]` is prerendered from `generateStaticParams`, and a single
 * `cookies()` call during its render — even inside a Suspense boundary — makes
 * the entire route dynamic and gives back the LCP F2 bought (spec §7). So the
 * published reviews are an anonymous cached read tagged to the product, and
 * the form, which needs to know who is asking, is a client component that
 * fetches its own state after hydration.
 *
 * Only APPROVED reviews are fetched, enforced in the service's `where` rather
 * than filtered here, so nothing on this page can leak the moderation queue.
 */

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value);
}

export async function ProductReviews({
  productId,
  slug,
  ratingAvg,
  ratingCount,
}: {
  productId: string;
  slug: string;
  ratingAvg: number;
  ratingCount: number;
}) {
  const page = await listProductReviewsCached(productId, slug);

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="reveal flex flex-col gap-8 border-t border-[var(--color-line)] pt-10"
    >
      <h2
        id="reviews-heading"
        className="font-display text-2xl font-semibold tracking-tight"
      >
        Reviews
      </h2>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="flex flex-col gap-6">
          {ratingCount > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <p className="font-display text-4xl font-semibold tabular-nums">
                  {ratingAvg.toFixed(1)}
                </p>
                <Stars rating={ratingAvg} size="md" />
              </div>
              <p className="text-sm text-[var(--color-muted)]">
                {ratingCount} {ratingCount === 1 ? "review" : "reviews"}
              </p>
              <RatingBreakdown breakdown={page.breakdown} total={page.total} />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">
              No reviews yet. Be the first to write one.
            </p>
          )}

          <div className="border-t border-[var(--color-line)] pt-6">
            <h3 className="mb-4 text-sm font-medium">Write a review</h3>
            <ProductPersonal productId={productId} slot="review" />
          </div>
        </div>

        <div>
          {page.reviews.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">Nothing published yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-line)]">
              {page.reviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-2 py-5 first:pt-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars rating={review.rating} />
                    {review.title ? (
                      <p className="text-sm font-medium">{review.title}</p>
                    ) : null}
                  </div>

                  <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                    {/* First name only; the service never returns more. */}
                    <span>{review.authorName}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={review.createdAt.toISOString()}>
                      {formatDate(review.createdAt)}
                    </time>
                    {review.verifiedPurchase ? (
                      <>
                        <span aria-hidden="true">·</span>
                        {/* Computed from the author's own paid orders — not a
                            field anybody is able to send. */}
                        <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                          Verified purchase
                        </span>
                      </>
                    ) : null}
                  </p>

                  {/* Rendered as text. Review bodies are untrusted prose and
                      never reach `dangerouslySetInnerHTML`; F5's tools fence
                      the same text before it reaches the model. */}
                  <p className="max-w-prose whitespace-pre-line text-sm leading-relaxed">
                    {review.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {page.totalPages > 1 ? (
            <p className="pt-6 text-sm text-[var(--color-muted)]">
              Showing {page.reviews.length} of {page.total} reviews.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
