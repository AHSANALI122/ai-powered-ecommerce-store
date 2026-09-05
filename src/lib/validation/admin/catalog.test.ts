import { describe, expect, it } from "vitest";
import {
  imageRefSchema,
  priceSchema,
  productCreateSchema,
  productUpdateSchema,
  slugSchema,
  variantCreateSchema,
} from "@/lib/validation/admin/catalog";

/**
 * The admin catalogue boundary (SEC-16, SEC-14).
 *
 * These are the schemas that let a price into the system at all, so the tests
 * are written from the attacker's side of the form rather than the operator's:
 * what does a hand-rolled request get to say, and what happens to a field the
 * schema never named.
 */

const validVariant = {
  size: "M",
  colorName: "Ink",
  colorHex: "#101010",
  sku: "shirt-m-ink",
  stock: 4,
};

const validProduct = {
  slug: "linen-shirt",
  title: "Linen shirt",
  description: "A shirt made of linen.",
  gender: "MEN" as const,
  basePrice: "4999.00",
  categoryId: "cat_123",
};

describe("priceSchema", () => {
  it.each(["0", "1", "4999", "4999.5", "4999.99", 1250, "0.01"])(
    "accepts %s",
    (value) => {
      expect(priceSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    ["a negative amount", "-1"],
    ["more than two decimals", "10.005"],
    ["exponent notation", "1e3"],
    ["a thousands separator", "1,000"],
    ["whitespace padding only", " "],
    ["a currency symbol", "Rs 500"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
  ])("rejects %s", (_label, value) => {
    expect(priceSchema.safeParse(value).success).toBe(false);
  });

  it("keeps the typed characters rather than round-tripping through a float", () => {
    // 0.1 + 0.2 is the canonical float failure; the schema must never produce a
    // value that has been through one.
    expect(priceSchema.parse("1234567.89")).toBe("1234567.89");
  });
});

describe("slugSchema", () => {
  it.each(["linen-shirt", "shirt", "a1-b2"])("accepts %s", (value) => {
    expect(slugSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a path separator", "men/shirts"],
    ["traversal", ".."],
    ["a leading hyphen", "-shirt"],
    ["a trailing hyphen", "shirt-"],
    ["a double hyphen", "shirt--x"],
    ["spaces", "linen shirt"],
    ["an underscore", "linen_shirt"],
  ])("rejects %s", (_label, value) => {
    expect(slugSchema.safeParse(value).success).toBe(false);
  });

  it("lowercases, so two operators cannot create colliding URLs", () => {
    expect(slugSchema.parse("Linen-Shirt")).toBe("linen-shirt");
  });
});

describe("imageRefSchema (SEC-14)", () => {
  it.each([
    ["an uploaded path", "/uploads/abc123.jpg"],
    ["a seed image", "https://images.pexels.com/photos/1/x.jpg"],
    ["a blob upload", "https://store123.public.blob.vercel-storage.com/products/a.png"],
  ])("accepts %s", (_label, value) => {
    expect(imageRefSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["plain http", "http://images.pexels.com/photos/1/x.jpg"],
    ["an arbitrary host", "https://evil.example.com/a.png"],
    ["a lookalike host", "https://public.blob.vercel-storage.com.evil.test/a.png"],
    ["a protocol-relative URL", "//evil.example.com/a.png"],
    ["path traversal", "/uploads/../../etc/passwd"],
    ["an internal address", "http://169.254.169.254/latest/meta-data/"],
  ])("rejects %s", (_label, value) => {
    expect(imageRefSchema.safeParse(value).success).toBe(false);
  });
});

describe("variantCreateSchema", () => {
  it("normalises a SKU to upper case so uniqueness is not case-dependent", () => {
    expect(variantCreateSchema.parse(validVariant).sku).toBe("SHIRT-M-INK");
  });

  it("treats a null price as inherit-base rather than free", () => {
    const parsed = variantCreateSchema.parse({ ...validVariant, price: null });
    expect(parsed.price).toBeNull();
  });

  it.each([
    ["a negative stock", { stock: -1 }],
    ["a fractional stock", { stock: 1.5 }],
    ["a malformed colour", { colorHex: "red" }],
    ["a three-digit colour", { colorHex: "#fff" }],
    ["a SKU with a space", { sku: "SHIRT M" }],
  ])("rejects %s", (_label, patch) => {
    expect(variantCreateSchema.safeParse({ ...validVariant, ...patch }).success).toBe(
      false,
    );
  });
});

describe("productCreateSchema strictness", () => {
  it("accepts a well-formed product with inline variants", () => {
    const parsed = productCreateSchema.safeParse({
      ...validProduct,
      variants: [validVariant],
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["ratingAvg", "ratingCount", "source", "externalId", "id", "createdAt"])(
    "rejects a body carrying %s",
    (field) => {
      const result = productCreateSchema.safeParse({
        ...validProduct,
        [field]: "smuggled",
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejects an unknown field on update rather than ignoring it", () => {
    expect(productUpdateSchema.safeParse({ title: "x", stock: 99 }).success).toBe(false);
  });

  it("rejects an empty update body", () => {
    expect(productUpdateSchema.safeParse({}).success).toBe(false);
  });
});
