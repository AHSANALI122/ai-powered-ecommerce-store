import { prisma } from "@/lib/db";
import { getEmailSender } from "@/server/notifications/email";
import { renderNotification } from "@/server/notifications/render";

/**
 * The outbox worker (F6).
 *
 * The DoD it exists for: *a provider blip must not lose an email*. Three
 * mechanisms, and it is worth being precise about which one does what.
 *
 * **1. The row is written before the send is attempted.** Queueing happens
 * inside the transaction that caused it — capture writes its confirmation row
 * in the same transaction that marks the order paid — so there is no instant
 * at which an order is committed and its email is not. That is the part that
 * makes losing one impossible; everything below is about eventually sending it.
 *
 * **2. Claiming is a lease, not a flag.** `NotificationStatus` has no SENDING
 * state and the schema is fixed through F6, so the claim is expressed with the
 * two columns that exist: a conditional `updateMany` that only matches a row
 * still `QUEUED` and due, and pushes `nextAttemptAt` into the future. A second
 * worker — two cron invocations overlapping, a manual replay racing the
 * schedule — matches zero rows and moves on. If this process then dies
 * mid-send, the lease simply expires and the row becomes due again. The cost
 * of that design is honest and worth stating: a crash after the provider
 * accepted the message but before the row was flipped sends it twice. For a
 * shipping notification that is the right trade against never sending it.
 *
 * **3. `attempts` increments at claim time, not on failure.** A message that
 * crashes the process, or times out every time, still burns an attempt and
 * eventually lands in FAILED instead of being retried forever. A poison row
 * must not be able to occupy the worker.
 *
 * FAILED is terminal for the schedule but not for the data: `requeueFailed`
 * puts rows back, which is the outbox replay the spec asks for.
 */

/** Rows per invocation. Bounded so one run cannot outlive the cron window. */
const BATCH_SIZE = 25;

/** After this many claims a row stops being retried and lands in FAILED. */
export const MAX_ATTEMPTS = 5;

/**
 * How long a claim is held before another worker may retry the row.
 *
 * Longer than `SEND_TIMEOUT_MS` in email.ts, so a slow provider cannot cause
 * the same message to be picked up twice while the first send is still open.
 */
const LEASE_MS = 60_000;

/**
 * Exponential backoff with a ceiling: ~1m, 5m, 25m, 2h.
 *
 * The ceiling matters more than the growth. An hours-long gap between the
 * third and fourth try of a verification email is worse than useless — the
 * token in it has expired by then — so the wait tops out where a provider
 * outage is either over or is being dealt with by a human.
 */
const BACKOFF_MS = [60_000, 300_000, 1_500_000, 7_200_000] as const;

function backoffFor(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index]!;
}

export interface WorkerSummary {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Drains up to one batch of due rows.
 *
 * Rows are claimed one at a time rather than as a set: `updateMany` reports
 * how many rows it changed but not which, and "which" is exactly what a worker
 * needs to know it owns. One conditional update per row is a handful of
 * queries against an operation whose cost is dominated by the provider round
 * trip anyway.
 */
export async function processOutbox(limit = BATCH_SIZE): Promise<WorkerSummary> {
  const now = new Date();
  const summary: WorkerSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0 };

  const due = await prisma.notification.findMany({
    where: {
      status: "QUEUED",
      // A null `nextAttemptAt` means "never scheduled", which is due now.
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  if (due.length === 0) return summary;

  const sender = getEmailSender();

  for (const candidate of due) {
    const leaseUntil = new Date(Date.now() + LEASE_MS);

    // The claim. Re-asserting QUEUED and the due time is what makes this safe
    // against a concurrent worker: exactly one of them changes a row.
    const claimed = await prisma.notification.updateMany({
      where: {
        id: candidate.id,
        status: "QUEUED",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      data: { attempts: { increment: 1 }, nextAttemptAt: leaseUntil },
    });
    if (claimed.count === 0) continue; // Somebody else got it.

    const row = await prisma.notification.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        type: true,
        to: true,
        subject: true,
        payload: true,
        attempts: true,
      },
    });
    if (!row) continue;

    summary.claimed += 1;

    const payload =
      row.payload !== null && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};

    let outcome;
    try {
      const email = renderNotification(row.type, row.subject, payload);
      outcome = await sender.send(row.to, email);
    } catch (error) {
      // A template that throws is a bug in our code, not a provider blip, and
      // retrying it will throw again — but the row keeps its remaining
      // attempts so a fix deployed within the window still delivers it.
      outcome = {
        ok: false as const,
        retryable: true,
        error: error instanceof Error ? error.message : "render failed",
      };
    }

    if (outcome.ok) {
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          // Cleared so a SENT row can never look due again.
          nextAttemptAt: null,
          lastError: null,
        },
      });
      summary.sent += 1;
      continue;
    }

    const exhausted = !outcome.retryable || row.attempts >= MAX_ATTEMPTS;

    await prisma.notification.update({
      where: { id: row.id },
      data: {
        status: exhausted ? "FAILED" : "QUEUED",
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + backoffFor(row.attempts)),
        // Truncated: this column is read by operators, and a provider can
        // return a very long body.
        lastError: outcome.error.slice(0, 500),
      },
    });

    if (exhausted) {
      summary.failed += 1;
      // The one line an operator greps for. No message body, no payload — a
      // password-reset link must not end up in a log (SEC-25).
      console.error(
        `[outbox] giving up id=${row.id} type=${row.type} attempts=${row.attempts}`,
      );
    } else {
      summary.retrying += 1;
    }
  }

  return summary;
}

/**
 * Outbox replay: puts FAILED rows back in the queue, due immediately.
 *
 * The counterpart to "FAILED is terminal for the schedule". After a provider
 * outage that outlasted the backoff ladder, or after a bad `EMAIL_FROM` is
 * corrected, this is how the mail that was never sent goes out — the rows were
 * never deleted, which is the entire reason the outbox is a table.
 *
 * `attempts` resets, because the count measured the previous conditions.
 */
export async function requeueFailed(options: { olderThan?: Date; limit?: number } = {}) {
  const rows = await prisma.notification.findMany({
    where: {
      status: "FAILED",
      ...(options.olderThan ? { updatedAt: { lt: options.olderThan } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
    select: { id: true },
  });
  if (rows.length === 0) return { requeued: 0 };

  const result = await prisma.notification.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: "FAILED" },
    data: { status: "QUEUED", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });

  return { requeued: result.count };
}
