import { describe, expect, it } from "vitest";
import { buildAssistantTools } from "@/server/assistant/tools";
import { systemInstructions } from "@/server/assistant/prompt";
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from "@/server/assistant/sanitize";
import {
  addToCartInput,
  removeFromCartInput,
  updateCartQuantityInput,
  viewCartInput,
} from "@/lib/validation/assistant";

/**
 * SEC-26 and SEC-2, asserted against the tool set itself rather than against
 * anything the model does with it.
 *
 * These tests never execute a tool — that needs Postgres, and the DB-backed
 * behaviour is covered by the integration suite. What they check is the shape
 * of the capability the model is handed, which is the part that has to stay
 * true no matter what the model is talked into: five read tools, three cart
 * writes, and no route to money or to an operator's powers.
 *
 * If a future feature adds a tool, one of these fails. That is the point: the
 * tool surface is small enough to enumerate, so it should be enumerated — and
 * enumerating it is how adding one becomes a decision somebody made on purpose
 * rather than a diff nobody read.
 */

const USER_ID = "usr_test_1";

const READ_TOOLS = [
  "searchProducts",
  "recommendByInterest",
  "getProductDetails",
  "filterByBudget",
  "viewCart",
] as const;

/**
 * Every tool that changes something. All three change one line of one cart —
 * the caller's — and every one of them is undone by a shopper in a click.
 */
const WRITE_TOOLS = ["addToCart", "removeFromCart", "updateCartQuantity"] as const;

describe("the assistant's tool surface", () => {
  it("is exactly the five read tools plus the three cart writes", () => {
    const names = Object.keys(buildAssistantTools(USER_ID)).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it("has no tool that could take money, place an order or change stock", () => {
    // The F5 DoD in one assertion: "refuses to checkout/pay" is not a promise
    // the prompt makes, it is a capability that does not exist.
    const names = Object.keys(buildAssistantTools(USER_ID));
    const forbidden =
      /checkout|order|pay|refund|price|discount|coupon|stock|inventory|user|admin|address/i;
    const offenders = names.filter(
      (name) =>
        !WRITE_TOOLS.includes(name as (typeof WRITE_TOOLS)[number]) &&
        forbidden.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it("has no way to empty a cart in one call", () => {
    // The write tools are deliberately per-line. A `clearCart` or a
    // `removeAll` would be the one cart capability worth injecting a product
    // review for, so its absence is asserted rather than assumed.
    const names = Object.keys(buildAssistantTools(USER_ID));
    expect(names.filter((name) => /clear|empty|reset|all/i.test(name))).toEqual([]);
  });

  it("gives every cart write a variantId and nothing that names a person", () => {
    // SEC-3: the cart being changed comes from the closure. A tool that took
    // a cartId, an itemId or a userId would be a tool an injected instruction
    // could point at somebody else's basket — and SEC-4 is the reason there is
    // no price on any of them either.
    const writes = [
      ["addToCart", addToCartInput],
      ["removeFromCart", removeFromCartInput],
      ["updateCartQuantity", updateCartQuantityInput],
    ] as const;

    for (const [name, schema] of writes) {
      const fields = Object.keys(schema.shape);
      expect(fields, name).toContain("variantId");
      expect(
        fields.filter((field) =>
          /user|cart(?!Quantity)|item|customer|price|total|role/i.test(field),
        ),
        name,
      ).toEqual([]);
    }
  });

  it("gives viewCart no input at all, so it can only read the caller's cart", () => {
    expect(Object.keys(viewCartInput.shape)).toEqual([]);
  });

  it("builds a distinct tool set per user, so identity cannot be shared", () => {
    // Not a deep assertion about the closure — just that nothing is cached
    // across users, which is the mistake that would make SEC-3 untrue.
    expect(buildAssistantTools("usr_a")).not.toBe(buildAssistantTools("usr_b"));
  });

  it("describes every tool, because an undescribed tool gets called wrongly", () => {
    for (const [name, definition] of Object.entries(buildAssistantTools(USER_ID))) {
      expect(definition.description, name).toBeTruthy();
      expect(definition.inputSchema, name).toBeTruthy();
    }
  });
});

describe("system instructions", () => {
  const instructions = systemInstructions("The shopper's cart is empty.");

  it("carries the cart summary it was given and nothing else about the shopper", () => {
    expect(instructions).toContain("The shopper's cart is empty.");
    // SEC-25: no identifier, no contact detail, no order history in the prompt.
    expect(instructions).not.toMatch(/@|\buserId\b|\bemail\b/i);
  });

  it("names the untrusted fence, so the markers and the prompt cannot drift apart", () => {
    expect(instructions).toContain(UNTRUSTED_OPEN);
    expect(instructions).toContain(UNTRUSTED_CLOSE);
  });

  it("states the money boundary the tool set already enforces", () => {
    expect(instructions).toMatch(/cannot place an order/i);
    expect(instructions).toMatch(/\/cart/);
  });

  it("tells the model the cart is the shopper's and not to empty it", () => {
    // Behaviour, not enforcement — the enforcement is that no tool empties a
    // cart. This is here so the two do not drift apart silently.
    expect(instructions).toMatch(/cannot empty a cart/i);
    expect(instructions).toMatch(/removeFromCart/);
    expect(instructions).toMatch(/viewCart/);
  });
});
