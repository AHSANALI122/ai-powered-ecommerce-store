import { describe, expect, it } from "vitest";
import { safeValidateUIMessages } from "ai";
import { assistantChatSchema } from "@/lib/validation/assistant";
import { toUiMessages } from "@/server/assistant/messages";

/**
 * The point of this suite is the first test: it runs the AI SDK's own
 * validator, which is what the route hits when it opens the stream. A body
 * that this schema accepts must survive that validator, or the shopper gets a
 * 500 on "hi" — which is exactly what happened when the validated messages
 * were posted through unchanged and the SDK asked for the `id` the browser
 * does not send.
 */
describe("toUiMessages", () => {
  it("produces messages the AI SDK accepts", async () => {
    const parsed = assistantChatSchema.parse({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello", state: "done" }] },
        { role: "user", parts: [{ type: "text", text: "something linen" }] },
      ],
    });

    const result = await safeValidateUIMessages({ messages: toUiMessages(parsed) });
    expect(result.success).toBe(true);
  });

  it("gives every message a distinct id, ignoring any the client sent", () => {
    const parsed = assistantChatSchema.parse({
      messages: [
        { id: "same", role: "user", parts: [{ type: "text", text: "one" }] },
        { id: "same", role: "assistant", parts: [{ type: "text", text: "two" }] },
      ],
    });

    const ids = toUiMessages(parsed).map((message) => message.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain("same");
  });

  it("drops the streaming state a client echoes back", () => {
    const parsed = assistantChatSchema.parse({
      messages: [
        { role: "assistant", parts: [{ type: "text", text: "hi", state: "streaming" }] },
      ],
    });

    expect(toUiMessages(parsed)[0]?.parts).toEqual([{ type: "text", text: "hi" }]);
  });
});
