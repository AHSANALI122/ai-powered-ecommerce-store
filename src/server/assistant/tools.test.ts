import { describe, expect, it } from "vitest";
import { buildAssistantTools } from "@/server/assistant/tools";
import { systemInstructions } from "@/server/assistant/prompt";
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from "@/server/assistant/sanitize";

/**
 * SEC-26 and SEC-2, asserted against the tool set itself rather than against
 * anything the model does with it.
 *
 * These tests never execute a tool — that needs Postgres, and the DB-backed
 * behaviour is covered by the integration suite. What they check is the shape
 * of the capability the model is handed, which is the part that has to stay
 * true no matter what the model is talked into: five tools, four of them
 * read-only, one write, and no route to money or to an operator's powers.
 *
 * If a future feature adds a tool, one of these fails. That is the point: the
 * tool surface is small enough to enumerate, so it should be enumerated.
 */

const USER_ID = "usr_test_1";

const READ_TOOLS = [
  "searchProducts",
  "recommendByInterest",
  "getProductDetails",
  "filterByBudget",
] as const;

describe("the assistant's tool surface", () => {
  it("is exactly the four read tools plus addToCart", () => {
    const names = Object.keys(buildAssistantTools(USER_ID)).sort();
    expect(names).toEqual([...READ_TOOLS, "addToCart"].sort());
  });

  it("has no tool that could take money, place an order or change stock", () => {
    // The F5 DoD in one assertion: "refuses to checkout/pay" is not a promise
    // the prompt makes, it is a capability that does not exist.
    const names = Object.keys(buildAssistantTools(USER_ID));
    const forbidden =
      /checkout|order|pay|refund|price|discount|coupon|stock|inventory|user|admin|address|delete|clear/i;
    const offenders = names.filter(
      (name) => forbidden.test(name) && name !== "addToCart",
    );
    expect(offenders).toEqual([]);
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
});
