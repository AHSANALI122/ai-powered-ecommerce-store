/**
 * One-shot email configuration probe.
 *
 *   npm run mail:test -- you@example.com
 *
 * Sends a single real message through whatever `EMAIL_DRIVER` currently
 * selects, bypassing the outbox entirely. That is the point: when mail is not
 * arriving, the question is always "is it the provider, or is it that nothing
 * drained the queue?", and those two have completely different fixes. This
 * answers the first half on its own, and prints the provider's verbatim
 * refusal when it fails rather than truncating it into `lastError`.
 *
 * It writes no row and touches no user.
 */
import { serverEnv } from "../src/lib/env";
import { getEmailSender } from "../src/server/notifications/email";

const to = process.argv[2];

if (!to || !to.includes("@")) {
  console.error("usage: npm run mail:test -- you@example.com");
  process.exit(1);
}

const env = serverEnv();
const sender = await getEmailSender();

console.info(`[mail:test] driver=${sender.name} from=${env.EMAIL_FROM} to=${to}`);

if (sender.name === "log") {
  console.warn(
    '[mail:test] EMAIL_DRIVER is "log" — this prints the message and reports\n' +
      "[mail:test] success without sending it. Nothing will reach an inbox.",
  );
}

const outcome = await sender.send(to, {
  subject: "Test message",
  text:
    "This is a configuration test.\n\n" +
    "If you are reading it in your inbox, the sending half of the outbox works " +
    "and any missing mail is the queue not being drained.\n",
  html:
    "<p>This is a configuration test.</p>" +
    "<p>If you are reading it in your inbox, the sending half of the outbox " +
    "works and any missing mail is the queue not being drained.</p>",
});

if (outcome.ok) {
  console.info(`[mail:test] accepted by the provider (id=${outcome.id ?? "none"})`);
  console.info("[mail:test] check the inbox — and the spam folder.");
  process.exit(0);
}

console.error(`[mail:test] rejected (retryable=${outcome.retryable})`);
console.error(`[mail:test] ${outcome.error}`);
process.exit(1);
