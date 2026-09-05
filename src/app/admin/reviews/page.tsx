import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/current-user";
import { reviewListSchema } from "@/lib/validation/admin/operations";
import { listAdminReviews } from "@/server/admin/reviews";
import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

/**
 * Review moderation queue.
 *
 * Reviews are `PENDING` until approved, so nothing here has been seen by a
 * shopper yet — and nothing here has moved a product's star rating, because the
 * cached aggregate counts APPROVED rows only. Approving is therefore the moment
 * both of those become true at once, which is why the verdict and the
 * recompute share a transaction.
 */
export default async function AdminReviewsPage(props: PageProps<"/admin/reviews">) {
  await requireRole("STAFF", "ADMIN");

  const params = await props.searchParams;
  const parsed = reviewListSchema.safeParse(flatten(params));
  const query = parsed.success
    ? parsed.data
    : reviewListSchema.parse({ status: "PENDING" });

  const page = await listAdminReviews(query);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Reviews</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Review text is customer-authored. It is displayed as text and never interpreted
          as markup or as an instruction — the same rule the AI assistant&rsquo;s tools
          will enforce when they read it (SEC-2).
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-line)] p-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={query.status ?? ""}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Review text or product"
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-line)] px-4 py-2 text-sm"
        >
          Apply
        </button>
      </form>

      <ReviewQueue reviews={page.items} total={page.total} />
    </div>
  );
}

function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") out[key] = first;
  }
  return out;
}
