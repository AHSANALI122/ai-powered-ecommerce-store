import { describe, expect, it } from "vitest";
import { safeRelativePath } from "@/lib/safe-redirect";

describe("safeRelativePath", () => {
  it("keeps an ordinary in-app path", () => {
    expect(safeRelativePath("/account/orders")).toBe("/account/orders");
    expect(safeRelativePath("/p/linen-shirt?size=M")).toBe("/p/linen-shirt?size=M");
  });

  it("rejects an absolute URL to another site", () => {
    expect(safeRelativePath("https://evil.example/login")).toBe("/");
  });

  it("rejects a protocol-relative URL", () => {
    // The one that actually catches people out: browsers treat //evil.example
    // as a fully qualified URL, so a naive startsWith("/") check passes it.
    expect(safeRelativePath("//evil.example/login")).toBe("/");
  });

  it("rejects backslash and newline smuggling", () => {
    expect(safeRelativePath("/\\evil.example")).toBe("/");
    expect(safeRelativePath("/account\\..\\admin")).toBe("/");
    expect(safeRelativePath("/account\nSet-Cookie: x=1")).toBe("/");
  });

  it("falls back for empty, non-string and oversized values", () => {
    expect(safeRelativePath("")).toBe("/");
    expect(safeRelativePath(undefined)).toBe("/");
    expect(safeRelativePath(["/a", "/b"])).toBe("/");
    expect(safeRelativePath(`/${"a".repeat(600)}`)).toBe("/");
  });

  it("uses the caller's fallback", () => {
    expect(safeRelativePath("https://evil.example", "/account")).toBe("/account");
  });
});
