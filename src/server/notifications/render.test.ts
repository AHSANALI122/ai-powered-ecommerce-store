import { describe, expect, it } from "vitest";
import { renderNotification } from "@/server/notifications/render";

/**
 * The email templates (F6).
 *
 * Two properties are worth a test, and neither is about wording.
 *
 * **Escaping.** A display name is text a shopper chose, and a webmail client
 * is a browser. Interpolating it raw is stored XSS with an unusually motivated
 * delivery mechanism.
 *
 * **Link containment.** An outbox row is a durable instruction to send someone
 * a clickable URL. Today only server code writes those rows, so an attacker
 * cannot plant one — but that is an assumption about the rest of the system,
 * and this is the place that stops being true quietly. A link is rendered only
 * when it points back at this application.
 */

describe("renderNotification", () => {
  it("escapes a name carrying markup", () => {
    const email = renderNotification("WELCOME", "Welcome", {
      name: '<script>alert(1)</script>',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("escapes an order number carrying markup", () => {
    const email = renderNotification("ORDER_CONFIRMATION", "Order confirmed", {
      orderNumber: '"><img src=x onerror=alert(1)>',
      total: "1200.00",
      currency: "PKR",
    });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });

  it("drops a link pointing at another host", () => {
    const email = renderNotification("PASSWORD_RESET", "Reset your password", {
      link: "https://evil.example/reset?token=abc",
    });
    expect(email.html).not.toContain("evil.example");
    expect(email.text).not.toContain("evil.example");
  });

  it("drops a javascript: link", () => {
    const email = renderNotification("EMAIL_VERIFICATION", "Confirm", {
      link: "javascript:alert(1)",
    });
    expect(email.html).not.toContain("javascript:");
  });

  it("keeps a link to this application", () => {
    const email = renderNotification("EMAIL_VERIFICATION", "Confirm", {
      link: "http://localhost:3000/verify-email?token=abc",
    });
    expect(email.html).toContain("/verify-email?token=abc");
  });

  it("prefers the stored subject over its own default", () => {
    // The subject was written when the event happened; this renderer is not
    // the authority on what the mail was for.
    const email = renderNotification("ORDER_SHIPPED", "Order A-1 is on its way", {
      orderNumber: "A-1",
    });
    expect(email.subject).toBe("Order A-1 is on its way");
  });

  it("falls back to a subject when the row has none", () => {
    const email = renderNotification("ORDER_SHIPPED", "", { orderNumber: "A-1" });
    expect(email.subject).toContain("A-1");
  });

  it("renders every notification type without throwing", () => {
    // A template that throws is a row that burns its retries on a bug rather
    // than on a provider. Cheap insurance against a missing switch arm.
    const types = [
      "WELCOME",
      "EMAIL_VERIFICATION",
      "PASSWORD_RESET",
      "ORDER_CONFIRMATION",
      "ORDER_SHIPPED",
      "ORDER_DELIVERED",
      "ORDER_REFUNDED",
    ] as const;

    for (const type of types) {
      // Deliberately empty: a payload can be missing keys, and the renderer
      // must degrade rather than crash.
      const email = renderNotification(type, "", {});
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.html).toContain("<html>");
      expect(email.text.length).toBeGreaterThan(0);
    }
  });

  it("prints an amount as the string it was given", () => {
    // AD-6: money must not pass through a JS number on its way to a mail.
    const email = renderNotification("ORDER_REFUNDED", "Refunded", {
      orderNumber: "A-1",
      amount: "1234.50",
      currency: "PKR",
      reason: "OUT_OF_STOCK",
    });
    expect(email.html).toContain("PKR 1234.50");
  });

  it("does not leak an internal reason code to the shopper", () => {
    const email = renderNotification("ORDER_REFUNDED", "Refunded", {
      orderNumber: "A-1",
      reason: "OUT_OF_STOCK",
    });
    expect(email.html).not.toContain("OUT_OF_STOCK");
    expect(email.html).toContain("sold out");
  });
});
