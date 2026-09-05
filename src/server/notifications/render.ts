import type { NotificationType } from "@/generated/prisma/enums";
import { publicEnv } from "@/lib/env";

/**
 * Turning an outbox row into an email (F6).
 *
 * Pure: payload in, subject and body out, no database and no network. That is
 * what makes the templates testable without a mail provider, and it is why the
 * worker can be reasoned about separately from what the mail says.
 *
 * **Everything interpolated is escaped.** A payload carries a display name and
 * an order number, and a display name is user-supplied text that a shopper
 * chose. Interpolating it raw into HTML is stored XSS aimed at whoever opens
 * the mail — a webmail client is a browser. `escapeHtml` runs on every value,
 * including the ones that look structural.
 *
 * Links are the exception that proves the rule: they are built by the server
 * from `APP_URL` plus a token it just minted, never from anything a request
 * supplied, and they are still escaped before they reach an `href`.
 */

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A link is only ever emitted when it points at this application.
 *
 * The payload is server-written today, so this is defence in depth rather than
 * a live hole — but an outbox row is a durable instruction to send somebody a
 * clickable URL, and "the only writer is trusted" is the assumption that stops
 * being true first. Anything else renders as nothing.
 */
function safeLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    const base = new URL(publicEnv.NEXT_PUBLIC_APP_URL);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.host !== base.host) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Payload = Record<string, unknown>;

const SITE = publicEnv.NEXT_PUBLIC_SITE_NAME;

/** Shared chrome, so a template body is only ever its own paragraphs. */
function layout(heading: string, bodyHtml: string): string {
  return [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f5;`,
    `font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
    `<table role="presentation" width="100%" style="max-width:560px;background:#fff;`,
    `border-radius:12px;padding:32px"><tr><td>`,
    `<p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;`,
    `text-transform:uppercase;color:#6b6b6b">${escapeHtml(SITE)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `<p style="margin:32px 0 0;font-size:12px;color:#6b6b6b">`,
    `You are receiving this because you have an account at ${escapeHtml(SITE)}.</p>`,
    `</td></tr></table></td></tr></table></body></html>`,
  ].join("");
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">${escapeHtml(text)}</p>`;
}

function button(href: string, label: string): string {
  return (
    `<p style="margin:24px 0"><a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;` +
    `padding:12px 20px;border-radius:8px;font-size:14px">${escapeHtml(label)}</a></p>` +
    `<p style="margin:0 0 16px;font-size:12px;color:#6b6b6b;word-break:break-all">` +
    `Or paste this into your browser: ${escapeHtml(href)}</p>`
  );
}

/** Greeting that reads correctly whether or not a name was ever supplied. */
function greeting(payload: Payload): string {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  return name.length > 0 ? `Hi ${name},` : "Hi,";
}

function orderNumber(payload: Payload): string {
  return typeof payload.orderNumber === "string" ? payload.orderNumber : "";
}

/**
 * Amounts arrive as the strings the money layer produced and are printed
 * verbatim. Re-formatting here would mean parsing a decimal into a JS number
 * to render it, which is the one thing AD-6 forbids — and the mail must say
 * exactly what the order says.
 */
function amount(payload: Payload, key: string): string | null {
  const value = payload[key];
  const currency = typeof payload.currency === "string" ? payload.currency : "";
  if (typeof value !== "string" && typeof value !== "number") return null;
  return `${currency} ${value}`.trim();
}

/**
 * Renders one outbox row.
 *
 * The stored `subject` wins over anything computed here: it was written when
 * the event happened and it is what the queueing code intended to say. This
 * function supplies one only if the row somehow has none.
 */
export function renderNotification(
  type: NotificationType,
  subject: string,
  payload: Payload,
): RenderedEmail {
  const hello = greeting(payload);

  switch (type) {
    case "WELCOME": {
      const shopUrl = new URL("/", publicEnv.NEXT_PUBLIC_APP_URL).toString();
      return {
        subject: subject || `Welcome to ${SITE}`,
        html: layout(
          `Welcome to ${SITE}`,
          paragraph(hello) +
            paragraph(
              "Your account is ready. Confirm your email address and you can check out, " +
                "track orders and save products to a wishlist.",
            ) +
            button(shopUrl, "Start shopping"),
        ),
        text: `${hello}\n\nYour account at ${SITE} is ready.\n${shopUrl}\n`,
      };
    }

    case "EMAIL_VERIFICATION": {
      const link = safeLink(payload.link);
      return {
        subject: subject || "Confirm your email address",
        html: layout(
          "Confirm your email address",
          paragraph(hello) +
            paragraph("Confirm this address to finish setting up your account.") +
            (link ? button(link, "Confirm email") : "") +
            paragraph("If you did not create an account, you can ignore this message."),
        ),
        text: `${hello}\n\nConfirm your email address:\n${link ?? ""}\n`,
      };
    }

    case "PASSWORD_RESET": {
      const link = safeLink(payload.link);
      return {
        subject: subject || "Reset your password",
        html: layout(
          "Reset your password",
          paragraph(hello) +
            paragraph("Use the link below to choose a new password. It expires shortly.") +
            (link ? button(link, "Reset password") : "") +
            paragraph(
              "If you did not ask for this, nothing has changed and you can ignore it.",
            ),
        ),
        text: `${hello}\n\nReset your password:\n${link ?? ""}\n`,
      };
    }

    case "ORDER_CONFIRMATION": {
      const number = orderNumber(payload);
      const total = amount(payload, "total");
      const url = new URL(
        `/account/orders/${encodeURIComponent(number)}`,
        publicEnv.NEXT_PUBLIC_APP_URL,
      ).toString();
      return {
        subject: subject || `Order ${number} confirmed`,
        html: layout(
          "Your order is confirmed",
          paragraph(hello) +
            paragraph(`We have your payment for order ${number}.`) +
            (total ? paragraph(`Total: ${total}`) : "") +
            button(url, "View your order"),
        ),
        text: `${hello}\n\nOrder ${number} is confirmed.${total ? `\nTotal: ${total}` : ""}\n${url}\n`,
      };
    }

    case "ORDER_SHIPPED": {
      const number = orderNumber(payload);
      const url = new URL(
        `/account/orders/${encodeURIComponent(number)}`,
        publicEnv.NEXT_PUBLIC_APP_URL,
      ).toString();
      return {
        subject: subject || `Order ${number} is on its way`,
        html: layout(
          "Your order is on its way",
          paragraph(hello) +
            paragraph(`Order ${number} has shipped.`) +
            button(url, "Track your order"),
        ),
        text: `${hello}\n\nOrder ${number} has shipped.\n${url}\n`,
      };
    }

    case "ORDER_DELIVERED": {
      const number = orderNumber(payload);
      const url = new URL(
        `/account/orders/${encodeURIComponent(number)}`,
        publicEnv.NEXT_PUBLIC_APP_URL,
      ).toString();
      return {
        subject: subject || `Order ${number} was delivered`,
        html: layout(
          "Your order was delivered",
          paragraph(hello) +
            paragraph(`Order ${number} has been delivered. We hope it fits.`) +
            paragraph("If something is not right, reply to this email and we will sort it.") +
            button(url, "Review your order"),
        ),
        text: `${hello}\n\nOrder ${number} was delivered.\n${url}\n`,
      };
    }

    case "ORDER_REFUNDED": {
      const number = orderNumber(payload);
      const refunded = amount(payload, "amount");
      // The reason is an internal token ("OUT_OF_STOCK"); a shopper gets the
      // sentence, not the enum.
      const outOfStock = payload.reason === "OUT_OF_STOCK";
      return {
        subject: subject || `Order ${number} refunded`,
        html: layout(
          "Your order has been refunded",
          paragraph(hello) +
            paragraph(
              outOfStock
                ? `An item in order ${number} sold out while your payment was being ` +
                    `confirmed, so we have refunded the order in full.`
                : `Order ${number} has been refunded.`,
            ) +
            (refunded ? paragraph(`Refunded: ${refunded}`) : "") +
            paragraph("Refunds usually reach your account within a few working days."),
        ),
        text:
          `${hello}\n\nOrder ${number} has been refunded.` +
          `${refunded ? `\nRefunded: ${refunded}` : ""}\n`,
      };
    }
  }
}
