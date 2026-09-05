/**
 * The star primitives, shared by the summary, the list and the form.
 *
 * A rating is a number, and the visual is a decoration of it. Both components
 * therefore carry the number in text for assistive technology and mark the
 * glyphs `aria-hidden` — a screen reader that announces "star star star star
 * star" has told the listener nothing about whether it was four or five.
 */

/** Read-only display. Server component: no interactivity, so no client bundle. */
export function Stars({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "md";
}) {
  const rounded = Math.round(rating);
  const dimension = size === "md" ? "text-lg" : "text-sm";

  return (
    <span className={`inline-flex items-center gap-0.5 ${dimension}`}>
      <span aria-hidden="true" className="tracking-tight text-amber-500">
        {"★".repeat(rounded)}
        <span className="text-[var(--color-line)]">{"★".repeat(5 - rounded)}</span>
      </span>
      <span className="sr-only">{rating.toFixed(1)} out of 5</span>
    </span>
  );
}

/**
 * The distribution histogram.
 *
 * Deliberately not a chart library: five rows of a proportional bar, where the
 * bar is presentational and the count beside it is the actual information.
 */
export function RatingBreakdown({
  breakdown,
  total,
}: {
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
  total: number;
}) {
  const stars = [5, 4, 3, 2, 1] as const;

  return (
    <ul className="flex flex-col gap-1.5">
      {stars.map((star) => {
        const count = breakdown[star];
        const percent = total === 0 ? 0 : Math.round((count / total) * 100);
        return (
          <li key={star} className="flex items-center gap-3 text-xs">
            <span className="w-10 shrink-0 text-[var(--color-muted)]">
              {star} star
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
            >
              <span
                className="block h-full rounded-full bg-amber-500"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums text-[var(--color-muted)]">
              {count}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
