/**
 * Local outbox drainer (F6).
 *
 * The outbox is drained in production by `/api/cron/send-notifications`, which
 * Vercel Cron calls every two minutes (`vercel.json`). Nothing calls it on a
 * development machine, so a queued verification email stays QUEUED forever and
 * registering looks like "email is broken" when the row was written correctly.
 * This is the local half of that job.
 *
 *   npm run mail:send            # drain once
 *   npm run mail:watch           # drain every 5s alongside `next dev`
 *   npm run mail:send -- --replay  # requeue FAILED rows first, then drain
 *
 * It calls `processOutbox` directly rather than going over HTTP, so it needs
 * no running server and no CRON_SECRET. That is safe for the same reason two
 * overlapping cron invocations are: the worker claims each row with a
 * conditional update, so this racing the real cron divides the batch rather
 * than sending anything twice.
 */
import { serverEnv } from "../src/lib/env";
import { processOutbox, requeueFailed } from "../src/server/notifications/worker";
import { prisma } from "../src/lib/db";

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const replay = args.has("--replay");

/** Long enough that an idle queue is quiet, short enough to feel immediate. */
const POLL_MS = 5_000;

async function drain(): Promise<void> {
  const summary = await processOutbox();
  if (summary.claimed === 0) return;
  console.info(
    `[outbox] claimed=${summary.claimed} sent=${summary.sent} ` +
      `retrying=${summary.retrying} failed=${summary.failed}`,
  );
}

async function main(): Promise<void> {
  const env = serverEnv();

  // The distinction that matters to somebody debugging "no email arrived":
  // draining with the log driver is a successful send that reaches no inbox.
  if (env.EMAIL_DRIVER === "log") {
    console.warn(
      '[outbox] EMAIL_DRIVER="log": messages are printed below, not delivered.\n' +
        '          Set EMAIL_DRIVER="resend" with RESEND_API_KEY to send for real.\n',
    );
  }

  if (replay) {
    const { requeued } = await requeueFailed();
    console.info(`[outbox] requeued ${requeued} failed row(s)`);
  }

  if (!watch) {
    await drain();
    await prisma.$disconnect();
    return;
  }

  console.info(`[outbox] watching, polling every ${POLL_MS / 1000}s — ctrl-c to stop\n`);
  // Sequential, never overlapping: a slow provider must not stack up runs.
  for (;;) {
    await drain();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
