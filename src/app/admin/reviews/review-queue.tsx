"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, FormNotice } from "@/components/ui/form";
import { Button } from "@/components/admin/ui";
import { Badge, EmptyState } from "@/components/admin/table";
import type { AdminReviewRow } from "@/server/admin/reviews";

/**
 * Moderation queue.
 *
 * `{review.body}` is a JSX text child, so React escapes it. That is worth
 * stating out loud rather than leaving implicit: this is the one screen in the
 * application where an authenticated privileged user reads text an anonymous
 * customer wrote, and it is precisely where `dangerouslySetInnerHTML` would be
 * a stored-XSS-to-admin-session pipeline.
 */
export function ReviewQueue({
  reviews,
  total,
}: {
  reviews: AdminReviewRow[];
  total: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function moderate(id: string, status: "APPROVED" | "REJECTED" | "PENDING") {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await apiFetch<{
        review: { ratingAvg: string; ratingCount: number; productSlug: string };
      }>(`/api/admin/reviews/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNotice(
        `Review ${status.toLowerCase()}. ${result.data.review.productSlug} now shows ${result.data.review.ratingAvg} from ${result.data.review.ratingCount} review(s).`,
      );
      router.refresh();
    });
  }

  if (reviews.length === 0) {
    return <EmptyState>Nothing to moderate here.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      <p className="text-xs text-[var(--color-muted)]">
        {total.toLocaleString()} review{total === 1 ? "" : "s"}
      </p>

      <ul className="flex flex-col gap-3">
        {reviews.map((review) => (
          <li
            key={review.id}
            className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  <span aria-label={`${review.rating} out of 5`}>
                    {"★".repeat(review.rating)}
                    <span className="text-[var(--color-muted)]">
                      {"★".repeat(5 - review.rating)}
                    </span>
                  </span>{" "}
                  {review.title ? <span>· {review.title}</span> : null}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  <Link
                    href={`/admin/products/${review.productId}`}
                    className="underline underline-offset-4"
                  >
                    {review.productTitle}
                  </Link>{" "}
                  · {review.authorName ?? review.authorEmail} ·{" "}
                  {review.createdAt.toISOString().slice(0, 10)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {review.verifiedPurchase ? (
                  <Badge tone="good">verified purchase</Badge>
                ) : (
                  <Badge>unverified</Badge>
                )}
                <Badge
                  tone={
                    review.status === "APPROVED"
                      ? "good"
                      : review.status === "REJECTED"
                        ? "bad"
                        : "warn"
                  }
                >
                  {review.status.toLowerCase()}
                </Badge>
              </div>
            </div>

            <p className="whitespace-pre-wrap text-sm text-[var(--color-muted)]">
              {review.body}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {review.status !== "APPROVED" ? (
                <Button
                  tone="primary"
                  disabled={pending}
                  onClick={() => moderate(review.id, "APPROVED")}
                >
                  Approve
                </Button>
              ) : null}
              {review.status !== "REJECTED" ? (
                <Button
                  tone="danger"
                  disabled={pending}
                  onClick={() => moderate(review.id, "REJECTED")}
                >
                  Reject
                </Button>
              ) : null}
              {review.status !== "PENDING" ? (
                <Button disabled={pending} onClick={() => moderate(review.id, "PENDING")}>
                  Send back to pending
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
