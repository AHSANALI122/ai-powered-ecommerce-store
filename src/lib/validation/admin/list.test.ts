import { describe, expect, it } from "vitest";
import {
  ADMIN_PAGE_SIZE_MAX,
  adminListSchema,
  paginate,
  paged,
} from "@/lib/validation/admin/list";

/**
 * SEC-24 on the admin surface.
 *
 * Two bounds, and both of them matter more here than on the storefront: an
 * admin listing reads across every user's orders, so an uncapped page size is a
 * one-request export and a user-controlled sort key is a user-controlled
 * `ORDER BY`.
 */

const schema = adminListSchema(["placedAt", "grandTotal"] as const);

describe("adminListSchema", () => {
  it("defaults to the first sort key, descending, on page one", () => {
    expect(schema.parse({})).toMatchObject({
      page: 1,
      sort: "placedAt",
      dir: "desc",
    });
  });

  it("rejects a sort key that is not on the whitelist", () => {
    // The attack this closes: ?sort=passwordHash reaching an orderBy.
    expect(schema.safeParse({ sort: "passwordHash" }).success).toBe(false);
    expect(schema.safeParse({ sort: "user.email" }).success).toBe(false);
  });

  it("rejects a page size above the cap instead of silently clamping it", () => {
    expect(schema.safeParse({ pageSize: "100000" }).success).toBe(false);
    expect(schema.parse({ pageSize: String(ADMIN_PAGE_SIZE_MAX) }).pageSize).toBe(
      ADMIN_PAGE_SIZE_MAX,
    );
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects page %s", (page) => {
    expect(schema.safeParse({ page }).success).toBe(false);
  });

  it("rejects an unknown parameter rather than ignoring it", () => {
    expect(schema.safeParse({ orderBy: "id" }).success).toBe(false);
  });

  it("bounds the free-text filter so it cannot become an expensive scan", () => {
    expect(schema.safeParse({ q: "x".repeat(81) }).success).toBe(false);
  });
});

describe("paginate", () => {
  it("derives skip/take from a validated page", () => {
    expect(paginate({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(paginate({ page: 3, pageSize: 25 })).toEqual({ skip: 50, take: 25 });
  });
});

describe("paged", () => {
  it("reports at least one page even when there are no results", () => {
    expect(paged([], 0, { page: 1, pageSize: 25 }).pageCount).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(paged([], 51, { page: 1, pageSize: 25 }).pageCount).toBe(3);
  });
});
