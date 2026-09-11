import type { EmailSender, SendOutcome } from "@/server/notifications/email";
import type { RenderedEmail } from "@/server/notifications/render";

/**
 * The SMTP driver: send through an ordinary mailbox at a provider that
 * already owns a verified domain.
 *
 * This is the answer to "I have no domain". Resend, SES and every other API
 * provider make you prove you own the sending domain by publishing DNS
 * records, which you cannot do without a domain; the shared
 * `onboarding@resend.dev` sender exists but only delivers to the Resend
 * account owner, so it can test a template and never serve a customer. An
 * SMTP relay moves that proof to the relay operator: Gmail already knows you
 * own your Gmail address, so an App Password lets the app send as it.
 *
 * The trade is deliverability and volume, not correctness. Gmail caps a
 * personal account near 500 recipients a day and rewrites the envelope sender
 * to the authenticated mailbox, so `EMAIL_FROM` must be `SMTP_USER`. It is a
 * real launch path for a small store and a good one for staging; a store
 * sending thousands of order emails wants a verified domain regardless.
 *
 * Nodemailer is imported lazily so the `log` and `resend` paths never pull a
 * Node-only socket library into a module graph that the Next bundler also
 * walks for edge and client boundaries.
 */

/** Matches the Resend driver: a hung relay must not hold the cron open. */
const SEND_TIMEOUT_MS = 10_000;

type Transporter = {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
};

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Split an SMTP failure into "try again" and "this will always fail".
 *
 * Exported and pure because it is the only part of this driver with a
 * decision in it, and the decision is the one that matters: a wrong call
 * either retries a permanently rejected address five times or burns the
 * entire queue to FAILED over a transient outage.
 */
export function classifySmtpError(error: unknown): {
  retryable: boolean;
  message: string;
} {
  const err = error as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof err?.code === "string" ? err.code : undefined;
  const responseCode =
    typeof err?.responseCode === "number" ? err.responseCode : undefined;
  const message =
    typeof err?.message === "string" && err.message.length > 0
      ? err.message
      : "smtp send failed";

  // Checked *before* the status code, and deliberately retryable. Gmail
  // answers a bad App Password with 535, which is a 5xx — classified by
  // number alone it would mark every queued row FAILED the moment a password
  // is rotated or typo'd. The credentials are our configuration, not the
  // message: the row keeps its remaining attempts so a corrected secret
  // within the backoff window still delivers it. Past the cap it lands in
  // FAILED like anything else, and `mail:send --replay` is the way back.
  if (code === "EAUTH") {
    return { retryable: true, message: `smtp auth failed: ${message}` };
  }

  // The relay refused this specific envelope — the recipient or the sender
  // address is wrong, and it will be just as wrong on the fifth attempt.
  if (code === "EENVELOPE") {
    return { retryable: false, message: `smtp envelope rejected: ${message}` };
  }

  // Never reached the server, or lost it mid-conversation: DNS, connect,
  // greeting, socket and our own abort all land here. Nothing about the
  // message is known to be bad.
  if (
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "ECONNRESET"
  ) {
    return { retryable: true, message: `smtp connection: ${message}` };
  }

  if (responseCode !== undefined) {
    // SMTP's own split, and the same shape as the HTTP one the Resend driver
    // makes: 4xx is "not now" (greylisting, throttling, mailbox busy), 5xx is
    // "not ever" (no such user, message rejected).
    return { retryable: responseCode < 500, message: `smtp ${responseCode}: ${message}` };
  }

  // Unknown shape. Retryable is the safer default here: the attempt cap still
  // bounds it, whereas a wrong "permanent" silently drops a verification mail.
  return { retryable: true, message: `smtp: ${message}` };
}

export class SmtpSender implements EmailSender {
  readonly name = "smtp";

  private transporter: Transporter | undefined;

  constructor(private readonly config: SmtpConfig) {}

  private async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const { createTransport } = await import("nodemailer");
    this.transporter = createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.pass },
      // A batch is a handful of messages on a warm function; pooling would
      // hold a socket open past the invocation that opened it.
      pool: false,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    }) as unknown as Transporter;
    return this.transporter;
  }

  async send(to: string, email: RenderedEmail): Promise<SendOutcome> {
    try {
      const transporter = await this.getTransporter();
      const info = await transporter.sendMail({
        from: this.config.from,
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      return { ok: true, id: info.messageId ?? null };
    } catch (error) {
      const { retryable, message } = classifySmtpError(error);
      // Truncated at the boundary for the same reason the Resend driver
      // truncates: this string is written to `lastError` and read by a human.
      return { ok: false, retryable, error: message.slice(0, 300) };
    }
  }
}
