import { z } from "zod";
import { GENDERS } from "@/lib/validation/catalog-query";
import { MAX_LINE_QUANTITY, idSchema } from "@/lib/validation/cart";

/**
 * The assistant's input boundary (SEC-16, SEC-2).
 *
 * Two schemas live here and they guard different things.
 *
 * `assistantChatSchema` guards what the *browser* may post. The AI SDK's
 * `UIMessage` is a rich union — text, files, reasoning, tool calls with their
 * recorded outputs — and accepting it verbatim would mean accepting a
 * client-authored transcript of tool results the server never produced. So the
 * wire format here is deliberately narrower than `UIMessage`: **text parts
 * only**. A forged `tool-searchProducts` output cannot be replayed into the
 * next turn's context, because there is no field it fits in.
 *
 * The cost of that is real and worth stating: the model does not carry a tool
 * result across turns. "Add the second one" makes it re-run the search rather
 * than trusting a variant id that arrived from the browser. Within a single
 * turn the agent loop keeps its own results in process, so search-then-add
 * works exactly as it should.
 *
 * The tool schemas guard what the *model* may ask for. Note what is absent
 * from every one of them: a price, a discount, a user id, an order id, a role.
 * The model cannot express those, so no amount of prompt injection can make it
 * ask for them (SEC-2, SEC-3, SEC-4).
 */

// ---------------------------------------------------------------------------
// Wire format: browser → /api/assistant/chat
// ---------------------------------------------------------------------------

/** One message may not exceed this many characters. */
export const MAX_MESSAGE_CHARS = 2_000;
/** How many turns of history the server will consider. */
export const MAX_HISTORY_MESSAGES = 20;

const textPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(MAX_MESSAGE_CHARS),
    // `useChat` streams text parts through a `streaming` → `done` state; it is
    // echoed back on the next request and is not something to reject over.
    state: z.enum(["streaming", "done"]).optional(),
  })
  .strict();

const messageSchema = z
  .object({
    id: z.string().max(64).optional(),
    // No "system": the instructions are the server's, and a client-supplied
    // system message is the oldest prompt-injection there is.
    role: z.enum(["user", "assistant"]),
    parts: z.array(textPartSchema).min(1).max(8),
  })
  .strict();

export const assistantChatSchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(MAX_HISTORY_MESSAGES),
  })
  .strict();

export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

// ---------------------------------------------------------------------------
// Tool inputs: model → server
// ---------------------------------------------------------------------------

/** Every read tool is capped; an uncapped `limit` is a scraper (SEC-24). */
export const TOOL_RESULT_LIMIT_MAX = 8;
const limitSchema = z.number().int().min(1).max(TOOL_RESULT_LIMIT_MAX).default(4);

/**
 * Prices the model may *filter* by. It cannot set one — `addToCart` has no
 * price field at all — but a budget is a legitimate search input, so it is
 * bounded here rather than trusted (SEC-4).
 */
const budgetSchema = z.number().min(0).max(100_000_000);

const genderSchema = z.enum(GENDERS);

export const searchProductsInput = z.object({
  query: z
    .string()
    .min(1)
    .max(80)
    .describe("Keywords from the shopper's own words, e.g. 'linen shirt'."),
  gender: genderSchema.optional().describe("MEN, WOMEN or UNISEX."),
  minPrice: budgetSchema.optional(),
  maxPrice: budgetSchema.optional(),
  size: z.string().min(1).max(16).optional().describe("Exact size label, e.g. 'M'."),
  color: z.string().min(1).max(32).optional().describe("Colour name, e.g. 'Navy'."),
  limit: limitSchema,
});

export const recommendByInterestInput = z.object({
  interest: z
    .string()
    .min(1)
    .max(120)
    .describe("What the shopper is dressing for, e.g. 'a beach holiday'."),
  gender: genderSchema.optional(),
  limit: limitSchema,
});

export const getProductDetailsInput = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .describe("The product slug exactly as a previous tool result returned it."),
});

export const filterByBudgetInput = z.object({
  maxPrice: budgetSchema.describe("Ceiling in the store's base currency."),
  minPrice: budgetSchema.optional(),
  gender: genderSchema.optional(),
  limit: limitSchema,
});

export const addToCartInput = z.object({
  variantId: idSchema.describe(
    "The variantId of a specific size and colour, exactly as a previous tool result returned it.",
  ),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
});
