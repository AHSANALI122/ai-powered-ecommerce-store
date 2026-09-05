import { describe, expect, it } from "vitest";
import {
  PAGE_MAX,
  PAGE_SIZE_DEFAULT,
  buildCatalogSearch,
  parseCatalogQuery,
} from "@/lib/validation/catalog-query";

/**
 * These are the SEC-24 tests. Every case here is a URL a visitor can type, and
 * the guarantee under test is that none of them can widen what the database is
 * asked to do.
 */

describe("parseCatalogQuery — sort whitelist", () => {
  it("accepts the five known sorts", () => {
    for (const sort of ["newest", "price-asc", "price-desc", "rating", "relevance"]) {
      expect(parseCatalogQuery({ sort }).sort).toBe(sort);
    }
  });

  it("falls back for anything else, including a column name", () => {
    // The attack: get a raw column into an orderBy. It cannot survive an enum.
    expect(parseCatalogQuery({ sort: "passwordHash" }).sort).toBe("newest");
    expect(parseCatalogQuery({ sort: "price-asc; DROP TABLE" }).sort).toBe("newest");
    expect(parseCatalogQuery({ sort: ["a", "b"] }).sort).toBe("newest");
  });
});

describe("parseCatalogQuery — pagination bounds", () => {
  it("caps page size", () => {
    expect(parseCatalogQuery({ pageSize: "100000" }).pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parseCatalogQuery({ pageSize: "48" }).pageSize).toBe(48);
    expect(parseCatalogQuery({ pageSize: "0" }).pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parseCatalogQuery({ pageSize: "-10" }).pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parseCatalogQuery({ pageSize: "12.7" }).pageSize).toBe(PAGE_SIZE_DEFAULT);
  });

  it("bounds the page number", () => {
    expect(parseCatalogQuery({ page: "3" }).page).toBe(3);
    expect(parseCatalogQuery({ page: String(PAGE_MAX + 1) }).page).toBe(1);
    expect(parseCatalogQuery({ page: "-1" }).page).toBe(1);
    expect(parseCatalogQuery({ page: "abc" }).page).toBe(1);
  });
});

describe("parseCatalogQuery — filters", () => {
  it("caps array filters and de-duplicates them", () => {
    const many = Array.from({ length: 40 }, (_, index) => `s${index}`);
    // Over the item cap the whole array is rejected rather than truncated: a
    // 40-value IN list is not a shopper narrowing a search.
    expect(parseCatalogQuery({ size: many }).size).toEqual([]);
    expect(parseCatalogQuery({ size: ["M", "M", "L"] }).size).toEqual(["M", "L"]);
    expect(parseCatalogQuery({ size: "M" }).size).toEqual(["M"]);
  });

  it("swaps a reversed price range instead of returning nothing", () => {
    const query = parseCatalogQuery({ minPrice: "3000", maxPrice: "2000" });
    expect(query.minPrice).toBe(2000);
    expect(query.maxPrice).toBe(3000);
  });

  it("ignores unparseable prices rather than erroring", () => {
    const query = parseCatalogQuery({ minPrice: "cheap", maxPrice: "-5" });
    expect(query.minPrice).toBeUndefined();
    expect(query.maxPrice).toBeUndefined();
  });

  it("bounds the search term", () => {
    expect(parseCatalogQuery({ q: "  linen  " }).q).toBe("linen");
    expect(parseCatalogQuery({ q: "x".repeat(200) }).q).toBeUndefined();
  });

  it("tolerates unknown params, which is what a campaign URL looks like", () => {
    const query = parseCatalogQuery({ utm_source: "newsletter", gclid: "abc" });
    expect(query.sort).toBe("newest");
    expect(query.page).toBe(1);
  });

  it("only accepts a known gender", () => {
    expect(parseCatalogQuery({ gender: "WOMEN" }).gender).toBe("WOMEN");
    expect(parseCatalogQuery({ gender: "OTHER" }).gender).toBeUndefined();
  });
});

describe("buildCatalogSearch", () => {
  it("omits defaults so a clean URL stays clean", () => {
    expect(buildCatalogSearch(parseCatalogQuery({}))).toBe("");
    expect(buildCatalogSearch(parseCatalogQuery({}), { page: 1 })).toBe("");
  });

  it("round-trips through the parser", () => {
    const original = parseCatalogQuery({
      size: ["M", "L"],
      color: "Navy",
      brand: "Meridian",
      sort: "price-asc",
      minPrice: "1000",
      inStock: "1",
      page: "3",
    });
    const search = buildCatalogSearch(original);
    const reparsed = parseCatalogQuery(
      Object.fromEntries(
        [...new URLSearchParams(search).keys()].map((key) => {
          const values = new URLSearchParams(search).getAll(key);
          return [key, values.length > 1 ? values : (values[0] ?? "")];
        }),
      ),
    );
    expect(reparsed).toEqual(original);
  });
});
