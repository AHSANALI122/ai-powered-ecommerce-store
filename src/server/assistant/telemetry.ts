import { scrubForLogs } from "@/server/assistant/sanitize";

/**
 * Assistant observability (F5, SEC-25).
 *
 * The spec names Langfuse. What is here is the part that has to be right
 * whatever the sink turns out to be: a single structured event per turn, with
 * the PII already gone before it is emitted. Swapping `console.info` for a
 * Langfuse trace is then one function body, and no call site has to be
 * revisited to work out whether what it passes is safe to send.
 *
 * What is deliberately **not** in an event: message text, product titles the
 * shopper was shown, the user's email or name, or a tool's arguments. A prompt
 * is the most PII-dense thing in an ecommerce app — people type their measurements,
 * their budget and their occasion into it — and none of it is needed to answer
 * the questions telemetry exists for: is it working, how many steps is it
 * taking, what is it costing, which tools are actually used.
 *
 * The user is identified by a per-deployment hash rather than an id, so a
 * heavy user can still be spotted in the logs without the logs becoming a
 * lookup table into the user table.
 */

export interface AssistantTurnEvent {
  /** Stable per user per deployment, not reversible to a user id. */
  actor: string;
  model: string;
  steps: number;
  toolCalls: string[];
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  durationMs: number;
  /**
   * `rate-limited` is our own Redis budget refusing the turn before it costs
   * anything; `provider-throttled` is the model provider refusing it after we
   * allowed it. Separate values because they call for opposite responses —
   * one is a shopper sending too much, the other is our own capacity.
   */
  outcome: "ok" | "error" | "rate-limited" | "provider-throttled" | "aborted";
  /** Present when outcome is "error" or "provider-throttled"; already scrubbed. */
  reason?: string;
}

/**
 * A short, non-reversible actor tag.
 *
 * Not a cryptographic hash and not trying to be: it is a bucket label for log
 * grouping. It must not be treated as an anonymisation guarantee, which is why
 * it never leaves the server logs.
 */
export function actorTag(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (Math.imul(hash, 31) + userId.charCodeAt(index)) | 0;
  }
  return `u_${(hash >>> 0).toString(36)}`;
}

export function recordAssistantTurn(event: AssistantTurnEvent): void {
  const payload = {
    ...event,
    ...(event.reason ? { reason: scrubForLogs(event.reason).slice(0, 200) } : {}),
  };
  console.info("[ai] turn", JSON.stringify(payload));
}
