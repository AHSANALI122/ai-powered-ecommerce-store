import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { jsonError, jsonOk } from "@/lib/http";
import { processOutbox, requeueFailed } from "@/server/notifications/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/send-notifications — drains the email outbox (F6).
 *
 * Scheduled in vercel.json and authenticated with `Authorization: Bearer
 * $CRON_SECRET`, the same as the order-expiry job. It is safe to call twice
 * over: the worker claims each row with a conditional update, so two
 * overlapping invocations divide the batch rather than duplicating it.
 *
 * `?replay=1` first requeues rows that have exhausted their retries. That is
 * the manual half of the outbox promise — after an outage that outlasted the
 * backoff ladder, an operator runs this once and the unsent mail goes out. It
 * is deliberately not automatic: a row reached FAILED because five attempts
 * did not work, and retrying it forever on a schedule would hide the problem
 * rather than surface it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorizeCron(request)) {
    return jsonError("UNAUTHORIZED", "Not permitted.");
  }

  const replay = request.nextUrl.searchParams.get("replay") === "1";
  const requeued = replay ? (await requeueFailed()).requeued : 0;

  const summary = await processOutbox();

  // One structured line per run: this is the only view of the outbox short of
  // querying it. Counts only — no addresses, no subjects, no payloads (SEC-25).
  console.info(
    `[outbox] run claimed=${summary.claimed} sent=${summary.sent} ` +
      `retrying=${summary.retrying} failed=${summary.failed} requeued=${requeued}`,
  );

  return jsonOk({ ...summary, requeued });
}
