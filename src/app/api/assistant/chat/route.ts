import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAgentUIStreamResponse } from "ai";
import { jsonError, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { serverEnv } from "@/lib/env";
import { assistantChatSchema } from "@/lib/validation/assistant";
import { buildAssistantAgent } from "@/server/assistant/agent";
import { toUiMessages } from "@/server/assistant/messages";
import { assistantAvailable } from "@/server/assistant/config";
import { actorTag, recordAssistantTurn } from "@/server/assistant/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Tool calls plus several model round trips; the default 15s is not enough. */
export const maxDuration = 60;

/**
 * Is this the provider saying "not now" rather than "no"?
 *
 * Gemini's free tier caps `generateContent` per model per day — 20 for
 * gemini-2.5-flash — and one shopper message can spend several of them,
 * because the agent loop makes a model call per step. So the budget runs out
 * during ordinary use, and it is a capacity limit rather than a fault.
 * "Something went wrong" is the wrong thing to say about it: the shopper
 * retries at once, spends more of what is left, and gets the same message.
 *
 * Matched on the status code where the SDK exposes one and on the provider's
 * own vocabulary otherwise — the SDK wraps a retried failure in an error that
 * carries the text but not the status, so neither check is redundant. Nothing
 * matched here reaches the shopper (SEC-26); it only chooses which of our own
 * two sentences to send.
 */
function isQuotaExhausted(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : "";
  return /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message);
}

/**
 * POST /api/assistant/chat — the AI shopping assistant (F5).
 *
 * The order of the checks below is the whole cost-and-abuse story, and it is
 * deliberately cheapest-first: kill switch, CSRF, session, rate limit, body.
 * Nothing reaches Gemini until a signed-in shopper with budget left has sent a
 * well-formed body from this origin.
 *
 * **Why a signed-in shopper.** The cart layer supports guests, and the human
 * add-to-cart path serves them. The assistant does not, for two reasons that
 * point the same way. SEC-3 says a tool derives the user from the session, and
 * a guest identity is a cookie this endpoint would have to mint mid-stream —
 * a `Set-Cookie` on a streaming response is exactly the kind of subtlety that
 * ends with two shoppers sharing a cart. And a per-user rate limit is only a
 * budget if the identity behind it costs something to obtain; an anonymous
 * bucket is a bucket per cookie, which is a bucket per request (SEC-8).
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const startedAt = Date.now();
  const env = serverEnv();

  // The kill switch answers before anything else so a runaway bill or a
  // provider outage can be contained with an env var and a redeploy.
  if (!assistantAvailable()) {
    return jsonError("INTERNAL", "The shopping assistant is unavailable right now.", {
      status: 503,
    });
  }

  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;
  const actor = actorTag(guard.user.id);

  // Two budgets. The per-user one is the real limit; the per-IP one catches a
  // pool of throwaway accounts behind a single host (SEC-8, SEC-18).
  const [byUser, byIp] = await Promise.all([
    rateLimit("ai:chat", `user:${guard.user.id}`),
    rateLimit("ai:chat", `ip:${clientIp(request.headers)}`),
  ]);
  const limited = !byUser.success ? byUser : !byIp.success ? byIp : null;
  if (limited) {
    recordAssistantTurn({
      actor,
      model: env.AI_MODEL,
      steps: 0,
      toolCalls: [],
      inputTokens: undefined,
      outputTokens: undefined,
      durationMs: Date.now() - startedAt,
      outcome: "rate-limited",
    });
    return jsonError(
      "RATE_LIMITED",
      "You have reached the assistant's limit for now. Try again later.",
      { headers: rateLimitHeaders(limited) },
    );
  }

  // `.strict()`, text parts only. See the note in validation/assistant.ts for
  // why a client-supplied tool result is not a thing this endpoint accepts.
  const parsed = await parseBody(request, assistantChatSchema);
  if (!parsed.ok) return parsed.response;

  const toolCalls: string[] = [];
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const agent = await buildAssistantAgent(guard.user.id);

    return await createAgentUIStreamResponse({
      agent,
      uiMessages: toUiMessages(parsed.data),
      // The browser can hang up mid-stream; without this the agent loop keeps
      // calling a paid model for an answer nobody will read.
      abortSignal: request.signal,
      onStepEnd({ toolCalls: calls, usage }) {
        steps += 1;
        for (const call of calls ?? []) toolCalls.push(call.toolName);
        // Accumulated per step: a turn that called three tools made four model
        // calls, and only the sum is a meaningful cost figure.
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
      },
      onEnd({ responseMessage }) {
        recordAssistantTurn({
          actor,
          model: env.AI_MODEL,
          steps,
          toolCalls,
          inputTokens,
          outputTokens,
          durationMs: Date.now() - startedAt,
          // A message with no parts means the loop ended without producing
          // anything — worth being able to spot in the logs.
          outcome: responseMessage.parts.length > 0 ? "ok" : "aborted",
        });
      },
      /**
       * What the shopper sees when the model or a tool throws (SEC-26). The
       * detail goes to the server log; the stream carries one sentence with
       * no provider name, no status code and no stack in it. The default
       * would be safe too, but relying on a library default for the one place
       * an internal error becomes user-visible text is not a habit worth
       * having.
       */
      onError(error) {
        const throttled = isQuotaExhausted(error);
        console.error("[ai] stream error", error);
        recordAssistantTurn({
          actor,
          model: env.AI_MODEL,
          steps,
          toolCalls,
          inputTokens,
          outputTokens,
          durationMs: Date.now() - startedAt,
          outcome: throttled ? "provider-throttled" : "error",
          reason: error instanceof Error ? error.message : "unknown",
        });
        return throttled
          ? "I am handling a lot of requests right now. Give me a moment and ask again."
          : "Sorry — something went wrong on my side. Try asking again.";
      },
    });
  } catch (error) {
    // Reached only when the agent could not be built at all (a bad model id, a
    // rejected key). The stream never opened, so this is an ordinary error body.
    console.error("[ai] assistant request failed", error);
    recordAssistantTurn({
      actor,
      model: env.AI_MODEL,
      steps,
      toolCalls,
      inputTokens: undefined,
      outputTokens: undefined,
      durationMs: Date.now() - startedAt,
      outcome: "error",
      reason: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("INTERNAL", "The shopping assistant is unavailable right now.");
  }
}
