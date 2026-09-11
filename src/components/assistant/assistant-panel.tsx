"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName, type UIMessage } from "ai";
import { CSRF_HEADER } from "@/lib/auth/cookie-names";
import { readCsrfToken } from "@/lib/client/api";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS } from "@/lib/validation/assistant";
import { useCartStore } from "@/stores/cart";
import { RichText } from "@/components/assistant/rich-text";
import { ProductSuggestions } from "@/components/assistant/product-suggestions";
import { collectSuggestions } from "@/components/assistant/suggestions";

/**
 * The assistant conversation (F5).
 *
 * Mounted only once the launcher is opened, so a shopper who never asks for it
 * pays nothing for it — not the AI SDK bundle, not a request. That is the
 * whole reason this is a separate module from the launcher.
 *
 * Two things about what leaves this component. The transport sends **only**
 * `{ messages }`, trimmed to text and to the last few turns; the server's
 * `.strict()` schema rejects anything else anyway, and matching it here means
 * a rejection is a bug rather than an everyday occurrence. And the CSRF header
 * is attached per request rather than once at construction, because the cookie
 * it echoes is rotated (SEC-1).
 */

const SUGGESTIONS = [
  "Something linen for a hot-weather wedding",
  "Smart but comfortable for the office",
  "What do you have under 5000?",
];

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("");
}

/**
 * The sentence to show for a failed turn.
 *
 * The route already decides what a shopper should be told — a provider that is
 * momentarily out of budget reads differently from a bug, and its own rate
 * limit differently again — and this component used to throw all of that away
 * for one fixed string. So: prefer the server's sentence, fall back only when
 * there isn't a usable one.
 *
 * Two shapes arrive here. A failure *inside* the stream surfaces as the plain
 * text the route's `onError` returned. A request rejected *before* the stream
 * opened (503 kill switch, 429 budget, 401) surfaces as the raw `jsonError`
 * body, so its message is dug out rather than shown as JSON.
 *
 * Anything else — a proxy's HTML error page, a bare network failure, an empty
 * string — falls through to the generic sentence. The point is to be more
 * specific when we can be, never to render whatever arrives.
 */
const FALLBACK_ERROR = "Something went wrong. Try asking again.";

function errorMessage(error: Error | undefined): string {
  const raw = error?.message?.trim();
  if (!raw) return FALLBACK_ERROR;

  if (raw.startsWith("{")) {
    try {
      const body = JSON.parse(raw) as { error?: { message?: unknown } };
      const message = body.error?.message;
      return typeof message === "string" && message.trim() ? message : FALLBACK_ERROR;
    } catch {
      return FALLBACK_ERROR;
    }
  }

  // A sentence, not a stack trace or a markup blob.
  const plausible = raw.length <= 200 && !/[<\n]/.test(raw);
  return plausible ? raw : FALLBACK_ERROR;
}

/**
 * What the shopper is told while a tool runs.
 *
 * Named per tool rather than a generic spinner: "Looking through the
 * catalogue" is a promise that the answer will come from the catalogue, which
 * is exactly the thing the F5 DoD is about. `addToCart` says what it did,
 * because a write is not something to report vaguely.
 */
const TOOL_LABELS: Record<string, string> = {
  searchProducts: "Searching the catalogue…",
  recommendByInterest: "Looking for something that fits…",
  getProductDetails: "Checking sizes and stock…",
  filterByBudget: "Finding pieces in that budget…",
  addToCart: "Adding to your cart…",
  viewCart: "Reading your cart…",
  removeFromCart: "Taking that out of your cart…",
  updateCartQuantity: "Updating your cart…",
};

/**
 * The tool outputs of one message, for the suggestion strip.
 *
 * Only completed calls, and only the payload — the tool *name* is not consulted
 * on purpose. What a result is worth showing is decided by its shape in
 * suggestions.ts, so a tool renamed or added does not need this list updated to
 * keep working, and cannot start rendering something new by being named
 * plausibly.
 */
function toolOutputs(message: UIMessage): unknown[] {
  return message.parts
    .filter((part) => isToolUIPart(part) && part.state === "output-available")
    .map((part) => (part as { output: unknown }).output);
}

/**
 * The waiting indicator.
 *
 * Three dots on a staggered loop, with the word beside them still saying what
 * is happening — the animation is the reassurance, the text is the
 * information. Under reduced motion the keyframes collapse and the dots simply
 * sit there, which is exactly why they are never the only thing on the line.
 */
function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1 rounded-full bg-current"
          style={{
            animation: "typing-dot 1.2s var(--ease-interaction) infinite",
            animationDelay: `${index * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const setCartCount = useCartStore((state) => state.setCount);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/assistant/chat",
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ messages }) => ({
          headers: { [CSRF_HEADER]: readCsrfToken() ?? "" },
          body: {
            // Text parts only, newest turns only — the same shape the server
            // will accept, so nothing is sent that would only be discarded.
            messages: messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
              role: message.role,
              parts: [{ type: "text" as const, text: textOf(message) }],
            })),
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    /**
     * The cart badge in the header is client state, and the assistant has just
     * changed the cart behind its back. Re-reading the count here is what
     * stops the header disagreeing with what the shopper was told.
     */
    onFinish: () => {
      void (async () => {
        try {
          const response = await fetch("/api/cart", { credentials: "same-origin" });
          if (!response.ok) return;
          const body = (await response.json()) as { cart: { itemCount: number } };
          setCartCount(body.cart.itemCount);
        } catch {
          /* the badge is cosmetic; a failure here is not worth surfacing */
        }
      })();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Follow the conversation as it streams, unless the shopper has scrolled up.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submit(text: string) {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (trimmed.length === 0 || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div
      role="dialog"
      aria-label="Shopping assistant"
      className="animate-scale-in flex h-[min(34rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-elevated)] shadow-[var(--shadow-panel)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[linear-gradient(120deg,var(--color-accent-soft),transparent_65%)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-sm text-[var(--color-accent)]"
          >
            ✦
          </span>
          <div>
            <p className="text-sm font-semibold">Shopping assistant</p>
            <p className="text-xs text-[var(--color-muted)]">
              Finds real stock. You check out yourself.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the shopping assistant"
          className="rounded-full p-1.5 text-lg leading-none text-[var(--color-muted)] transition-colors duration-200 hover:bg-[var(--color-subtle)] hover:text-[var(--color-ink)]"
        >
          ×
        </button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="animate-fade-up text-[var(--color-muted)]">
              Tell me what you are looking for, or what you are dressing for.
            </p>
            <div className="stagger flex flex-col items-start gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-left text-xs transition-[border-color,transform,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`animate-fade-up ${
                  message.role === "user" ? "flex justify-end" : ""
                }`}
              >
                {message.role === "user" ? (
                  <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-ink)] px-3.5 py-2 text-[var(--color-surface)] shadow-[var(--shadow-card)]">
                    {textOf(message)}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return <RichText key={index} text={part.text} />;
                      }
                      if (isToolUIPart(part)) {
                        const name = getToolName(part);
                        // Only the "running" state is shown. The result itself
                        // is the model's to describe — dumping a tool payload
                        // into the transcript is how raw rows reach a screen.
                        return part.state === "output-available" ||
                          part.state === "output-error" ? null : (
                          <p
                            key={index}
                            className="flex items-center gap-2 text-xs italic text-[var(--color-muted)]"
                          >
                            <TypingDots />
                            {TOOL_LABELS[name] ?? "Working…"}
                          </p>
                        );
                      }
                      return null;
                    })}

                    {/* The products this answer actually named, with their
                        pictures. Rendered once under the whole message rather
                        than per text part, so a two-paragraph answer does not
                        show the same shirt twice. */}
                    <ProductSuggestions
                      products={collectSuggestions(toolOutputs(message), textOf(message))}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {status === "submitted" ? (
          <p className="mt-3 flex items-center gap-2 text-xs italic text-[var(--color-muted)]">
            <TypingDots />
            Thinking…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="animate-fade-in mt-3 text-xs text-red-600">
            {errorMessage(error)}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="flex items-center gap-2 border-t border-[var(--color-line)] px-3 py-3"
      >
        <label htmlFor="assistant-input" className="sr-only">
          Ask the shopping assistant
        </label>
        <input
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={MAX_MESSAGE_CHARS}
          autoComplete="off"
          placeholder="Ask for something…"
          className="min-w-0 flex-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--color-ink)] focus:shadow-[var(--shadow-card)]"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="rounded-full border border-[var(--color-line)] px-3.5 py-2 text-xs transition-colors duration-200 hover:border-[var(--color-ink)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={input.trim().length === 0}
            aria-label="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-sm text-[var(--color-surface)] transition-[transform,opacity,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:shadow-[var(--shadow-lift)] active:translate-y-px disabled:opacity-35"
          >
            <span aria-hidden="true">↑</span>
          </button>
        )}
      </form>

      <p className="border-t border-[var(--color-line)] px-4 py-2 text-[11px] text-[var(--color-muted)]">
        Suggestions come from live stock. Prices and totals are confirmed at{" "}
        <Link href="/cart" className="link-sweep font-medium text-[var(--color-ink)]">
          your cart
        </Link>
        .
      </p>
    </div>
  );
}
