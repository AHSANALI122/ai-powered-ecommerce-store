import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_REVALIDATE_SECONDS } from "@/lib/cache-tags";

/**
 * Next reads `export const revalidate` by static analysis, so the catalogue
 * pages have to repeat the literal instead of importing the constant. This is
 * the guard against the two halves drifting apart silently — a page quietly
 * revalidating on a different window than the one we documented is the kind of
 * bug nobody notices until a price is stale for an hour.
 */
const SEGMENTS = ["src/app/page.tsx", "src/app/p/[slug]/page.tsx", "src/app/sitemap.ts"];

describe("catalogue revalidate window", () => {
  it.each(SEGMENTS)("%s exports the documented literal", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    const match = /export const revalidate = (\d+);/.exec(source);

    expect(match, `${relativePath} has no literal revalidate export`).not.toBeNull();
    expect(Number(match?.[1])).toBe(CATALOG_REVALIDATE_SECONDS);
  });
});
