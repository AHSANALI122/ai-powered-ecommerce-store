import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/env";

/**
 * robots.txt (F2).
 *
 * The disallow list mirrors the `noindex` metadata on those routes. Both exist
 * because they do different jobs: `noindex` keeps a page out of the index if it
 * is crawled anyway, this keeps crawl budget off private and transactional
 * paths in the first place.
 *
 * `/api/` is disallowed because a JSON endpoint has nothing to offer a search
 * engine — not as a security measure. Access control lives in the handlers.
 */
export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/account",
          "/checkout",
          "/admin",
          "/login",
          "/register",
          "/verify-email",
          "/forgot-password",
          "/reset-password",
          "/search",
          "/api/",
        ],
      },
    ],
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base,
  };
}
