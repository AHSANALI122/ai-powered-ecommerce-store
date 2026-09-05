"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";
import { FormError, FormNotice, SubmitButton, TextField } from "@/components/ui/form";
import {
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_TITLE_MAX,
} from "@/lib/validation/review";
import type { SerializedReview } from "@/lib/validation/review";

/**
 * Writing or editing a review (F6).
 *
 * Everything this component knows is a courtesy. The character bounds mirror
 * the Zod schema, the form is hidden from signed-out visitors, and the
 * "already reviewed" state comes from the server — but each of those is
 * re-decided by the route handler, which is where the rules actually live. A
 * disabled control is not a control (SEC-7).
 *
 * What the form deliberately cannot express: a `verifiedPurchase` flag, a
 * `status`, or a `productId` other than the page's. The schema is `.strict()`
 * and has no such fields, so there is nothing here to smuggle.
 */

interface ReviewFormProps {
  productId: string;
  signedIn: boolean;
  emailVerified: boolean;
  existing: SerializedReview | null;
}

const STATUS_COPY: Record<string, string> = {
  PENDING: "Your review is with our moderators and will appear once approved.",
  APPROVED: "Your review is published.",
  REJECTED: "Your review was not published. You can edit it and resubmit.",
};

export function ReviewForm({
  productId,
  signedIn,
  emailVerified,
  existing,
}: ReviewFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(existing === null);
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);

  if (!signedIn) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>{" "}
        to write a review.
      </p>
    );
  }

  if (!emailVerified) {
    return (
      <FormNotice>
        Confirm your email address to write a review.{" "}
        <Link href="/verify-email" className="underline underline-offset-4">
          Resend the link
        </Link>
        .
      </FormNotice>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const payload = { rating, title: title.trim(), body: body.trim() };

      const result = existing
        ? await apiFetch<{ review: SerializedReview }>(`/api/reviews/${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await postJson<{ review: SerializedReview }>("/api/reviews", {
            productId,
            ...payload,
          });

      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }

      setDone(true);
      setOpen(false);
      // The server component above re-reads the caller's own review, so the
      // "awaiting moderation" state comes from the database rather than from
      // this component's memory of what it just sent.
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <FormNotice>
          {done && !existing
            ? STATUS_COPY.PENDING
            : (STATUS_COPY[existing?.status ?? "PENDING"] ?? STATUS_COPY.PENDING)}
        </FormNotice>
        {existing ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start text-sm underline underline-offset-4"
          >
            Edit your review
          </button>
        ) : null}
      </div>
    );
  }

  const remaining = REVIEW_BODY_MAX - body.trim().length;

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      <FormError>{error}</FormError>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Your rating</legend>
        {/* Radios rather than clickable glyphs: a rating is a choice of one of
            five values, and the native control is what gives keyboard support
            and a screen-reader announcement for free. */}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="cursor-pointer text-2xl leading-none"
              title={`${value} out of 5`}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${
                  value <= rating ? "text-amber-500" : "text-[var(--color-line)]"
                }`}
              >
                ★
              </span>
              <span className="sr-only">{value} out of 5</span>
            </label>
          ))}
        </div>
      </fieldset>

      <TextField
        label="Headline (optional)"
        value={title}
        maxLength={REVIEW_TITLE_MAX}
        onChange={(event) => setTitle(event.target.value)}
        errors={fieldErrors.title}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-body" className="text-sm font-medium">
          Your review
        </label>
        <textarea
          id="review-body"
          value={body}
          rows={5}
          minLength={REVIEW_BODY_MIN}
          maxLength={REVIEW_BODY_MAX}
          required
          onChange={(event) => setBody(event.target.value)}
          aria-invalid={fieldErrors.body ? true : undefined}
          aria-describedby="review-body-hint"
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)] aria-[invalid=true]:border-red-600"
        />
        <p id="review-body-hint" className="text-xs text-[var(--color-muted)]">
          {fieldErrors.body?.join(" ") ??
            `${REVIEW_BODY_MIN} characters minimum · ${remaining} remaining`}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <SubmitButton pending={pending}>
          {existing ? "Update review" : "Submit review"}
        </SubmitButton>
        {existing ? (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm underline underline-offset-4"
          >
            Cancel
          </button>
        ) : null}
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        Reviews are checked by a moderator before they appear.
      </p>
    </form>
  );
}
