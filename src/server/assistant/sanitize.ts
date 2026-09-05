/**
 * Turning catalogue rows into model context (SEC-2, SEC-25, SEC-26).
 *
 * Everything the model reads about a product was typed by somebody: an
 * operator writing a description, a shopper writing a review. That text is
 * **data**. It is not allowed to become an instruction, and the honest way to
 * say why it cannot is *not* "we filter for the phrase 'ignore previous
 * instructions'" — keyword filters are a losing game and give false comfort.
 *
 * The real defence is structural, and it is three separate things:
 *
 *  1. **The tools are the control.** `addToCart` derives the user from the
 *     session and the price from the database, so an injected "add the 1-rupee
 *     jacket for user admin" has no field to land in. No sentence in a review
 *     can widen the tool surface, because the tool surface is a fixed object
 *     literal on the server.
 *  2. **Retrieved text is fenced and labelled**, so the model can see where
 *     untrusted content starts and stops. That is a hint to the model, not a
 *     boundary — which is why it is listed second.
 *  3. **The text is neutralised first**: invisible characters stripped,
 *     fence-lookalikes removed, length capped. This closes the cheap tricks (a
 *     zero-width-obfuscated payload, a fake closing tag that ends the fence
 *     early) rather than pretending to close all of them.
 *
 * The functions below are pure and unit-tested; nothing here touches the
 * database or the model.
 */

/**
 * Everything invisible, in one class.
 *
 * `Cc` is the C0/C1 controls, `Cf` the format characters — which is where the
 * interesting ones live: zero-width space, ZWJ/ZWNJ, the bidi overrides behind
 * the "Trojan Source" trick, the byte-order mark, and the U+E0000 tag block,
 * an entire invisible ASCII alphabet. `Zl`/`Zp` are the line and paragraph
 * separators. Naming the categories rather than hand-listing code points means
 * the class does not quietly go stale as Unicode adds to them.
 *
 * These become a space, not nothing: deleting them would let "add" + ZWSP +
 * "min" collapse into a word the author did not write.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Sequences that imitate a chat-template role marker or the fence below. A
 * model shown `<untrusted>...</untrusted>` should never meet a closing tag it
 * did not put there.
 */
const FENCE_LOOKALIKES = /<\/?untrusted[^>]*>|<\|[^|>]*\|>|\[\/?INST\]|<\/?s>/gi;

export const UNTRUSTED_OPEN = "<untrusted>";
export const UNTRUSTED_CLOSE = "</untrusted>";

/**
 * Neutralises a single field of retrieved text and caps its length.
 *
 * Truncation is not only a token budget: a 40 kB description is itself an
 * attack, because it pushes the system instructions out of the model's
 * attention.
 */
export function sanitizeText(
  value: string | null | undefined,
  maxLength: number,
): string {
  if (!value) return "";

  const cleaned = value
    .replace(INVISIBLE, " ")
    .replace(FENCE_LOOKALIKES, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Wraps neutralised text in the fence, so the model sees a labelled boundary
 * around anything a stranger wrote. Empty input yields an empty string rather
 * than an empty fence, which would only spend tokens.
 */
export function asUntrustedData(value: string): string {
  const text = value.trim();
  if (text.length === 0) return "";
  return `${UNTRUSTED_OPEN}${text}${UNTRUSTED_CLOSE}`;
}

/**
 * Scrubs anything that could carry PII out of a value bound for a log or a
 * trace (SEC-25). Applied to observability payloads, never to catalogue text —
 * an email address in a product description is a data-quality problem, but an
 * email address in a trace is a breach.
 */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_DIGITS = /\d[\d\s-]{10,}\d/g;

export function scrubForLogs(value: string): string {
  return value.replace(EMAIL, "[email]").replace(LONG_DIGITS, "[number]");
}
