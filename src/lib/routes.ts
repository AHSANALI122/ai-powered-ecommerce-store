import type { Route } from "next";

/**
 * `typedRoutes` is on, so every internal link is checked against the real route
 * tree at compile time — including template literals like `/p/${slug}`.
 *
 * What it cannot check is a path that only exists at runtime: a `?next=` value
 * from the URL, or a redirect target read from a request. Those are validated
 * instead by `safeRelativePath`, which is the actual security control here.
 * This helper is the single, greppable place where the compile-time check is
 * waived, so a cast never gets sprinkled inline.
 */
export function runtimeRoute(path: string): Route {
  return path as Route;
}
