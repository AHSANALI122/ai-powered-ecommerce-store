import { describe, expect, it } from "vitest";
import {
  MARKDOWN_LINK,
  isAllowedAssistantLink,
} from "@/components/assistant/link-policy";

/**
 * SEC-2, at the last layer: what the model's output is allowed to render as a
 * clickable link in the shopper's browser.
 *
 * The threat is not a mischievous model. It is a product description or a
 * customer review — text a stranger wrote, which the model reads as data —
 * containing something that talks the model into emitting a link. Whatever
 * reasoning produced the string, the renderer's answer to an off-site href is
 * the same: it is not a link, it is characters.
 */

describe("isAllowedAssistantLink", () => {
  it.each(["/p/linen-shirt", "/c/men/shirts", "/search", "/cart"])(
    "allows the storefront path %s",
    (href) => {
      expect(isAllowedAssistantLink(href)).toBe(true);
    },
  );

  it.each([
    "https://evil.example/pay",
    "http://evil.example",
    "//evil.example/pay",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "mailto:someone@example.com",
  ])("refuses to link %s", (href) => {
    expect(isAllowedAssistantLink(href)).toBe(false);
  });

  it("refuses a path that escapes the allowed area", () => {
    expect(isAllowedAssistantLink("/p/../admin")).toBe(false);
    expect(isAllowedAssistantLink("/p/..\\..\\admin")).toBe(false);
  });

  it("refuses internal paths the assistant has no business sending anyone to", () => {
    // Not because these are secret — they are guarded server-side — but because
    // "click here to confirm your payment" is the shape of every scam, and the
    // assistant is not allowed to produce it.
    for (const href of ["/admin", "/checkout", "/account/addresses", "/api/cart"]) {
      expect(isAllowedAssistantLink(href)).toBe(false);
    }
  });

  it("does not treat a prefix match as a path match", () => {
    expect(isAllowedAssistantLink("/carthage")).toBe(false);
    expect(isAllowedAssistantLink("/pages/evil")).toBe(false);
  });
});

describe("MARKDOWN_LINK", () => {
  it("matches an internal link and captures its label and path", () => {
    MARKDOWN_LINK.lastIndex = 0;
    const match = MARKDOWN_LINK.exec("Try the [Linen Shirt](/p/linen-shirt) today");
    expect(match?.[1]).toBe("Linen Shirt");
    expect(match?.[2]).toBe("/p/linen-shirt");
  });

  it("does not match an absolute URL at all, so it never reaches the policy", () => {
    MARKDOWN_LINK.lastIndex = 0;
    expect(MARKDOWN_LINK.exec("[Pay now](https://evil.example)")).toBeNull();
  });

  it("does not run a label across a line break", () => {
    MARKDOWN_LINK.lastIndex = 0;
    expect(MARKDOWN_LINK.exec("[a\nb](/p/x)")).toBeNull();
  });
});
