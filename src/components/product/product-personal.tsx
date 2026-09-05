"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { useAuthStore } from "@/stores/auth";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { ReviewForm } from "@/components/reviews/review-form";
import type { SerializedReview } from "@/lib/validation/review";

/**
 * The two parts of a product page that depend on who is looking (F6).
 *
 * A client component on purpose, and the purpose is rendering rather than
 * interactivity: `/p/[slug]` is prerendered from `generateStaticParams`, and
 * reading a cookie during its render — anywhere, including inside a Suspense
 * boundary — would turn every product page dynamic and undo F2's LCP work.
 * Fetching this state after hydration keeps the HTML anonymous and cacheable.
 *
 * The cost is honest: a signed-in shopper sees the heart and the review form
 * settle a moment after paint. Both reserve their space beforehand, so nothing
 * shifts (CLS), and neither is above the fold.
 *
 * Nothing here is a control. The API re-derives ownership and verification
 * from the session on every write; this component only decides what to draw.
 */

interface ProductState {
  wishlisted: boolean;
  review: SerializedReview | null;
  emailVerified: boolean;
}

/** What a visitor with no session has: nothing, on either widget. */
const SIGNED_OUT: ProductState = {
  wishlisted: false,
  review: null,
  emailVerified: false,
};

export function ProductPersonal({
  productId,
  slot,
}: {
  productId: string;
  /** Which of the two widgets to render; they share one fetch per slot. */
  slot: "wishlist" | "review";
}) {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const signedIn = status === "authenticated" && user !== null;

  const [fetched, setFetched] = useState<ProductState | null>(null);

  useEffect(() => {
    // Only a signed-in shopper has state to fetch. The signed-out and
    // still-resolving cases are derived below rather than written into state,
    // which keeps this effect to the one thing effects are for: talking to
    // something outside React.
    if (!signedIn) return;

    let cancelled = false;
    void (async () => {
      const result = await apiFetch<ProductState>(
        `/api/account/product-state?productId=${encodeURIComponent(productId)}`,
      );
      if (cancelled) return;
      // A 401 here means the session went away between the store and this
      // request; "signed out" is the right reading, not an error banner.
      setFetched(result.ok ? result.data : SIGNED_OUT);
    })();

    return () => {
      cancelled = true;
    };
  }, [productId, signedIn]);

  // `null` means "not known yet" — the session is still resolving, or the
  // fetch is in flight — and is what the placeholders below render for.
  const state: ProductState | null =
    status === "unknown" ? null : signedIn ? fetched : SIGNED_OUT;
  const loaded = state !== null;

  if (slot === "wishlist") {
    // Reserve the height before the answer arrives so the button appearing
    // shifts nothing below it.
    if (!loaded) return <div className="h-11" aria-hidden="true" />;
    return (
      <WishlistButton
        productId={productId}
        signedIn={signedIn}
        initiallySaved={state?.wishlisted ?? false}
        variant="full"
      />
    );
  }

  if (!loaded) {
    return (
      <p className="text-sm text-[var(--color-muted)]" role="status">
        Loading…
      </p>
    );
  }

  return (
    <ReviewForm
      productId={productId}
      signedIn={signedIn}
      emailVerified={state?.emailVerified ?? false}
      existing={state?.review ?? null}
    />
  );
}
