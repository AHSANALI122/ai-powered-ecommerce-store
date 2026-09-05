import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import type { NotificationType } from "@/generated/prisma/enums";

/**
 * Email outbox writer (spec §5, F6).
 *
 * Nothing here talks to an email provider. Handlers insert a QUEUED row inside
 * their own flow; the F6 worker sends it and flips SENT/FAILED with retries.
 * That is what makes a provider outage a delay rather than a lost password
 * reset.
 *
 * Queueing must never break the flow that queued it: a failure to record the
 * mail is logged and swallowed, because the account was still created.
 */

export interface QueueNotificationInput {
  type: NotificationType;
  to: string;
  subject: string;
  userId?: string | null;
  payload?: Record<string, unknown>;
}

export async function queueNotification(input: QueueNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        type: input.type,
        to: input.to.toLowerCase(),
        subject: input.subject,
        userId: input.userId ?? null,
        payload: (input.payload ?? {}) as never,
        status: "QUEUED",
        nextAttemptAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[notifications] failed to queue", input.type, error);
  }
}

/** Absolute URL for a link inside an email. */
export function appUrl(path: string): string {
  return new URL(path, serverEnv().APP_URL).toString();
}

/**
 * Until the F6 worker exists there is no way to read a verification link out of
 * an inbox, so in development the link is printed to the server log. Guarded on
 * NODE_ENV so a production deployment cannot log a credential-bearing URL.
 */
export function logActionLinkInDev(label: string, url: string): void {
  if (serverEnv().NODE_ENV === "production") return;
  console.info(`\n[dev-mail] ${label}\n           ${url}\n`);
}
