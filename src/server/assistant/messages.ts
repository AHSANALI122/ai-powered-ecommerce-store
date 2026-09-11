import type { UIMessage } from "ai";
import type { AssistantChatInput } from "@/lib/validation/assistant";

/**
 * The wire format → what the AI SDK will accept (F5).
 *
 * `assistantChatSchema` is deliberately narrower than `UIMessage` — text parts
 * only, see validation/assistant.ts — and it treats `id` as optional, because
 * an id from the browser is a display detail and not something the server
 * should depend on. `createAgentUIStreamResponse` validates its `uiMessages`
 * against the full `UIMessage` shape, where `id` is required; posting the
 * validated body straight through fails that check before the stream opens.
 *
 * So the id is minted here, from the message's position in the history that
 * was just validated. Any client id is ignored on purpose: nothing the browser
 * sends should be able to collide two turns onto one id.
 */
export function toUiMessages(input: AssistantChatInput): UIMessage[] {
  return input.messages.map((message, index) => ({
    id: `m${index}`,
    role: message.role,
    // Rebuilt rather than passed through, so the optional `state` a streaming
    // client echoes back never travels on into the model's context.
    parts: message.parts.map((part) => ({ type: "text" as const, text: part.text })),
  }));
}
