import { ProductGridSkeleton } from "@/components/catalog/product-card";

/**
 * The listing's loading state.
 *
 * A filtered listing is deliberately uncached (see the caching note in
 * CLAUDE.md), so changing a facet is a round trip to Postgres. This is what
 * fills that gap: the same page furniture, with the grid replaced by tiles of
 * the same geometry, so the layout is already in place when the products
 * arrive and only their content changes.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-[var(--color-line)] pb-6">
        <div className="shimmer h-8 w-56 rounded-full" />
        <div className="shimmer h-3 w-24 rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[16rem_1fr]">
        <div className="flex flex-col gap-4">
          <div className="shimmer h-3 w-20 rounded-full" />
          <div className="shimmer h-9 w-full rounded-lg" />
          <div className="shimmer h-3 w-16 rounded-full" />
          <div className="shimmer h-24 w-full rounded-lg" />
        </div>
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
