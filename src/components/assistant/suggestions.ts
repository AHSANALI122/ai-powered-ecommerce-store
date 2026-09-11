import { MARKDOWN_LINK } from "@/components/assistant/link-policy";

/**
 * Turning a turn's tool results into the products worth showing a picture of.
 *
 * The panel deliberately does not render tool payloads — see the note in
 * assistant-panel.tsx about raw rows reaching a screen. This is the one narrow
 * exception, and it is narrow in three ways that matter.
 *
 * **The fields are an allowlist, not a spread.** Only the eight below are
 * copied out, each one checked for its type first. A tool result that grows a
 * field later does not silently start appearing in a chat bubble.
 *
 * **Which products are shown is decided by the model's prose, not by the tool
 * result.** A search returns up to eight products; the assistant usually
 * recommends two. Showing all eight would contradict the answer next to them.
 * So a product is shown only when the answer links to it — `[Linen Shirt](/p/
 * linen-shirt)` — which is exactly the link the prompt already asks for and
 * the link policy already allows. The link is the model's expressed intent;
 * the card is that intent rendered with the picture attached.
 *
 * **The content is still the server's.** The model chooses *which* slug to
 * name; every value on the card — title, price, image URL — comes from the
 * tool result the server produced for that slug. A model that invents a slug
 * matches nothing here and gets no card, which is the same failure mode as an
 * invented link: nothing to click, nothing to see.
 */

export interface SuggestedProduct {
  slug: string;
  title: string;
  brand: string | null;
  /** Formatted by the caller; null when only a detail lookup was made. */
  price: string | null;
  currency: string;
  inStock: boolean;
  /** Always `/p/<slug>`, re-derived rather than trusted. */
  url: string;
  image: string | null;
}

/** `/p/<slug>` and nothing else — the shape the link policy already allows. */
const PRODUCT_PATH = /^\/p\/([A-Za-z0-9\-._~]{1,120})$/;

/** More than this in one answer is a catalogue dump, not a recommendation. */
const MAX_CARDS = 6;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * An image the panel will hand to `next/image`.
 *
 * The server already applied this rule in `toImageUrl` before the value left
 * the tool; it is applied again here because this is the side that renders,
 * and a renderer that trusts its input to have been checked elsewhere is a
 * renderer that breaks the day someone adds a second caller.
 */
function imageUrl(value: unknown): string | null {
  const candidate = str(value);
  if (!candidate) return null;
  if (candidate.startsWith("https://")) return candidate;
  if (
    candidate.startsWith("/") &&
    !candidate.startsWith("//") &&
    !candidate.includes("..")
  ) {
    return candidate;
  }
  return null;
}

/** A product as the listing tools return it. */
function fromCard(value: unknown): SuggestedProduct | null {
  if (!isBag(value)) return null;
  const slug = str(value.slug);
  const title = str(value.title);
  const currency = str(value.currency);
  if (!slug || !title || !currency) return null;

  return {
    slug,
    title,
    brand: str(value.brand),
    price: str(value.priceFrom),
    currency,
    inStock: value.inStock !== false,
    url: `/p/${slug}`,
    image: imageUrl(value.image),
  };
}

/**
 * A product as `getProductDetails` returns it: no top-level price, because the
 * price lives on the variants. The cheapest purchasable one is the same "from"
 * figure the listing tools report, so it is recomputed here rather than left
 * blank.
 */
function fromDetail(value: unknown): SuggestedProduct | null {
  if (!isBag(value)) return null;
  const base = fromCard(value);
  if (!base) return null;

  const variants = Array.isArray(value.variants) ? value.variants : [];
  const prices = variants
    .filter(isBag)
    .filter((variant) => variant.inStock !== false)
    .map((variant) => str(variant.price))
    .filter((price): price is string => price !== null)
    .filter((price) => Number.isFinite(Number(price)));

  const cheapest = prices.reduce<string | null>(
    (lowest, price) =>
      lowest === null || Number(price) < Number(lowest) ? price : lowest,
    null,
  );

  return {
    ...base,
    price: cheapest,
    inStock: prices.length > 0,
  };
}

/**
 * Every product the turn's tools produced, keyed by slug.
 *
 * Later results win, so a detail lookup refines the card a search put there —
 * which is the order the assistant works in anyway.
 */
function catalogueFrom(outputs: unknown[]): Map<string, SuggestedProduct> {
  const catalogue = new Map<string, SuggestedProduct>();

  for (const output of outputs) {
    if (!isBag(output)) continue;

    if (Array.isArray(output.products)) {
      for (const entry of output.products) {
        const product = fromCard(entry);
        if (product) catalogue.set(product.slug, product);
      }
    }

    if (isBag(output.product)) {
      const product = fromDetail(output.product);
      if (product) catalogue.set(product.slug, product);
    }
  }

  return catalogue;
}

/** Slugs the answer linked to, in the order it linked to them, deduplicated. */
function mentionedSlugs(text: string): string[] {
  const slugs: string[] = [];

  MARKDOWN_LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK.exec(text)) !== null) {
    const path = PRODUCT_PATH.exec(match[2] ?? "");
    const slug = path?.[1];
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }

  return slugs;
}

/**
 * The cards to show under one assistant message.
 *
 * `outputs` are the tool results of that message, `text` its prose. Both are
 * needed: the tool results are the only trustworthy source of what a product
 * *is*, and the prose is the only signal of which ones the answer is actually
 * about.
 */
export function collectSuggestions(outputs: unknown[], text: string): SuggestedProduct[] {
  const catalogue = catalogueFrom(outputs);
  if (catalogue.size === 0) return [];

  return mentionedSlugs(text)
    .map((slug) => catalogue.get(slug))
    .filter((product): product is SuggestedProduct => product !== undefined)
    .slice(0, MAX_CARDS);
}
