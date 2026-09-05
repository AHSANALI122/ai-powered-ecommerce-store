import { serverEnv } from "@/lib/env";
import type { RenderedEmail } from "@/server/notifications/render";

/**
 * The email provider boundary (F6).
 *
 * Same shape as `PaymentProvider` and `ImageStore`, for the same reason: the
 * worker should know that sending can fail, not who it fails to. Swapping
 * Resend for SES is this file plus one env value.
 *
 * Resend is spoken to over its REST API with `fetch` rather than through the
 * SDK. The SDK would add a dependency to wrap one POST, and the failure mode
 * that matters here — distinguishing "retry this" from "never retry this" —
 * is a decision about HTTP status codes that we have to make ourselves either
 * way.
 */

export type SendOutcome =
  | { ok: true; id: string | null }
  /**
   * `retryable` is the whole point of this type. A 500 or a socket error is a
   * provider blip and the row must go back in the queue; a 422 for a malformed
   * address will fail identically forever, and retrying it five times only
   * delays the moment someone notices.
   */
  | { ok: false; retryable: boolean; error: string };

export interface EmailSender {
  readonly name: string;
  send(to: string, email: RenderedEmail): Promise<SendOutcome>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

class ResendSender implements EmailSender {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(to: string, email: RenderedEmail): Promise<SendOutcome> {
    // A hung provider must not hold the cron invocation open until the
    // platform kills it mid-batch: an aborted send is retryable, a killed
    // function leaves its lease to expire.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id: body.id ?? null };
      }

      const detail = (await response.text().catch(() => "")).slice(0, 300);
      // 429 is rate limiting and 5xx is theirs; both clear on their own.
      // 4xx otherwise is this message being wrong, and it will stay wrong.
      const retryable = response.status === 429 || response.status >= 500;
      return { ok: false, retryable, error: `resend ${response.status}: ${detail}` };
    } catch (error) {
      // Network error, DNS, timeout: nothing about the message is known to be
      // bad, so it is retryable.
      return {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : "send failed",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The development driver: logs instead of sending.
 *
 * It reports success, so the whole outbox lifecycle — claim, send, flip to
 * SENT — is exercised on a machine with no mail provider. `env.ts` refuses it
 * in production, exactly as it refuses `PAYMENT_PROVIDER=fake`: a deployment
 * that silently logs password resets into a serverless stdout instead of
 * sending them is the kind of failure nobody notices until a customer cannot
 * get in.
 */
class LogSender implements EmailSender {
  readonly name = "log";

  async send(to: string, email: RenderedEmail): Promise<SendOutcome> {
    console.info(
      `\n[dev-mail] to: ${to}\n[dev-mail] subject: ${email.subject}\n` +
        `${email.text.trim().replace(/^/gm, "[dev-mail] ")}\n`,
    );
    return { ok: true, id: null };
  }
}

let cached: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (cached) return cached;
  const env = serverEnv();

  if (env.EMAIL_DRIVER === "resend") {
    if (!env.RESEND_API_KEY) {
      // Unreachable in production, where env.ts requires the key at boot. In
      // development it degrades to logging rather than failing every row.
      console.warn("[notifications] EMAIL_DRIVER=resend without a key; logging instead.");
      cached = new LogSender();
      return cached;
    }
    cached = new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM);
    return cached;
  }

  cached = new LogSender();
  return cached;
}

/** Test seam: drop the memoised driver so the next call re-reads env. */
export function resetEmailSender(): void {
  cached = undefined;
}
