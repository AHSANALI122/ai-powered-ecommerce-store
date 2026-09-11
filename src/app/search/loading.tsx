import { ProductGridSkeleton } from "@/components/catalog/product-card";

/**
 * Search's loading state.
 *
 * Search runs two queries — a trigram ranking pass and then the filtered
 * listing over those ids — so it is the slowest read on the site and the one
 * most worth showing progress for. Same geometry as the results, so nothing
 * moves when they land.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-[var(--color-line)] pb-6">
        <div className="shimmer h-3 w-20 rounded-full" />
        <div className="shimmer h-8 w-72 rounded-full" />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[16rem_1fr]">
        <div className="flex flex-col gap-4">
          <div className="shimmer h-3 w-20 rounded-full" />
          <div className="shimmer h-9 w-full rounded-lg" />
          <div className="shimmer h-3 w-16 rounded-full" />
          <div className="shimmer h-24 w-full rounded-lg" />
        </div>
        <ProductGridSkeleton count={4} />
      </div>
    </div>
  );
}
