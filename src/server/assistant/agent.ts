import { createGoogle } from "@ai-sdk/google";
import { ToolLoopAgent, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { serverEnv } from "@/lib/env";
import { systemInstructions } from "@/server/assistant/prompt";
import { buildAssistantTools, buildCartSummary } from "@/server/assistant/tools";

/**
 * Assembling the agent (AD-4, SEC-12, SEC-13).
 *
 * The provider is created here and nowhere else, so "swap Gemini for Vertex
 * AI, or the free tier for the paid one" is a change to env.ts and this file's
 * three lines — the tools, the prompt and the route know nothing about who is
 * serving the model.
 *
 * The API key is read through `serverEnv()`, which throws if it is ever
 * imported into browser code. That is the concrete mechanism behind "the key
 * never reaches the browser": this module is unimportable from a client
 * component, not merely un-imported by one.
 */

let cachedModel: LanguageModel | undefined;

function model(): LanguageModel {
  if (cachedModel) return cachedModel;
  const env = serverEnv();

  const google = createGoogle({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    // Unset means Google's public endpoint; set it to point at Vertex AI or a
    // regional proxy without touching code (AD-4).
    ...(env.GOOGLE_AI_BASE_URL ? { baseURL: env.GOOGLE_AI_BASE_URL } : {}),
  });

  cachedModel = google(env.AI_MODEL);
  return cachedModel;
}

/**
 * Builds the agent for one turn, for one signed-in shopper.
 *
 * Per-request because the tools close over the user id (SEC-3) and the
 * instructions carry that shopper's cart summary. Constructing a
 * `ToolLoopAgent` is cheap — it holds configuration, not a connection — so
 * there is nothing to gain by caching one and a whole identity-confusion class
 * of bug to gain by trying.
 */
export async function buildAssistantAgent(userId: string): Promise<ToolLoopAgent> {
  const env = serverEnv();
  const cartSummary = await buildCartSummary(userId);

  return new ToolLoopAgent({
    model: model(),
    instructions: systemInstructions(cartSummary),
    tools: buildAssistantTools(userId),
    /**
     * The tool-call iteration cap the F5 guardrails ask for. Each step is a
     * billed model call, so this bounds the cost of a single message as well
     * as a search-refine-search loop the model cannot get out of. When it is
     * hit the turn simply ends with whatever text exists, which reads as a
     * short answer rather than an error.
     */
    stopWhen: isStepCount(env.AI_MAX_STEPS),
    /**
     * Low, not zero. Product recommendation wants some variety in phrasing;
     * it does not want variety in whether the rules are followed.
     */
    temperature: 0.3,
    /**
     * Retry/backoff on a 429 or a transient 5xx, which the free tier hands out
     * readily. Stated rather than left to the default because it is a spec
     * requirement, and because the ceiling matters: a third attempt on a rate
     * limit is usually a fourth rate limit, and the shopper is waiting.
     */
    maxRetries: 2,
  });
}
