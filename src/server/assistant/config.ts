import { serverEnv } from "@/lib/env";

/**
 * Whether the assistant can serve a request at all.
 *
 * Its own module, not a function on agent.ts, for one reason: the root layout
 * needs this answer to decide whether to mount the widget, and importing
 * agent.ts would drag the AI SDK and the whole tool set into the server bundle
 * of every page on the site. This file imports nothing but env.
 *
 * `AI_ASSISTANT_ENABLED` is the kill switch; the key check is what makes a
 * half-configured development machine degrade to "no widget" rather than to a
 * button that 500s.
 */
export function assistantAvailable(): boolean {
  const env = serverEnv();
  return env.AI_ASSISTANT_ENABLED && Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
}
