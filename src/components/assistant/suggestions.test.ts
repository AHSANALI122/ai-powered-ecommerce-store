import { describe, expect, it } from "vitest";
import { collectSuggestions } from "@/components/assistant/suggestions";

/**
 * The picture strip under an answer.
 *
 * Two properties are worth holding onto here, and both are about the strip
 * agreeing with the words above it. A card appears only for a product the
 * answer linked to — otherwise a search that returned eight things would put
 * eight pictures under a sentence recommending two. And a card's *content*
 * comes only from a tool result — the model picks a slug, the server picks
 * everything else, so an invented slug produces nothing rather than a plausible
 * looking tile.
 */

const SHIRT = {
  slug: "linen-shirt",
  title: "Linen Shirt",
  brand: "Aire",
  priceFrom: "4990.00",
  currency: "PKR",
  inStock: true,
  url: "/p/linen-shirt",
  image: "https://images.pexels.com/photos/1/shirt.jpg",
};

const TROUSERS = {
  ...SHIRT,
  slug: "wide-trousers",
  title: "Wide Trousers",
  priceFrom: "7490.00",
  url: "/p/wide-trousers",
};

const searchResult = { ok: true, products: [SHIRT, TROUSERS] };

describe("collectSuggestions", () => {
  it("shows only the products the answer linked to", () => {
    const cards = collectSuggestions(
      [searchResult],
      "The [Linen Shirt](/p/linen-shirt) is the one I would wear in that heat.",
    );

    expect(cards.map((card) => card.slug)).toEqual(["linen-shirt"]);
    expect(cards[0]?.image).toBe(SHIRT.image);
    expect(cards[0]?.price).toBe("4990.00");
  });

  it("keeps the order the answer named them in, and shows each once", () => {
    const cards = collectSuggestions(
      [searchResult],
      "Try [Wide Trousers](/p/wide-trousers) with a [Linen Shirt](/p/linen-shirt). The [trousers](/p/wide-trousers) also work alone.",
    );

    expect(cards.map((card) => card.slug)).toEqual(["wide-trousers", "linen-shirt"]);
  });

  it("shows nothing for a slug no tool returned", () => {
    // The invented-product failure, on the rendering side: a model that names
    // a slug it was never given gets a dead link and no card, rather than a
    // tile that makes the invention look real.
    expect(
      collectSuggestions([searchResult], "You'd like [Silk Robe](/p/silk-robe)."),
    ).toEqual([]);
  });

  it("shows nothing when the answer linked to nothing", () => {
    expect(collectSuggestions([searchResult], "What size are you?")).toEqual([]);
  });

  it("ignores links that are not product pages", () => {
    expect(
      collectSuggestions([searchResult], "It is in [your cart](/cart) now."),
    ).toEqual([]);
  });

  it("drops an image URL that is not https or same-origin", () => {
    // Defence in depth: the server already filtered this. If a value ever gets
    // past it, the renderer must not be the thing that trusts it.
    const cards = collectSuggestions(
      [{ ok: true, products: [{ ...SHIRT, image: "javascript:alert(1)" }] }],
      "[Linen Shirt](/p/linen-shirt)",
    );

    expect(cards[0]?.image).toBeNull();
  });

  it("prices a detail result from its cheapest in-stock variant", () => {
    const detail = {
      ok: true,
      product: {
        slug: "linen-shirt",
        title: "Linen Shirt",
        currency: "PKR",
        image: SHIRT.image,
        variants: [
          { variantId: "v1", size: "S", price: "5990.00", inStock: false },
          { variantId: "v2", size: "M", price: "4990.00", inStock: true },
          { variantId: "v3", size: "L", price: "5490.00", inStock: true },
        ],
      },
    };

    const cards = collectSuggestions([detail], "[Linen Shirt](/p/linen-shirt)");
    expect(cards[0]?.price).toBe("4990.00");
    expect(cards[0]?.inStock).toBe(true);
  });

  it("survives a tool result of the wrong shape", () => {
    // A failed tool returns `{ ok: false, message }`, and an error part may
    // carry anything at all. Neither should take the panel down.
    expect(
      collectSuggestions(
        [{ ok: false, message: "That lookup did not work." }, null, "nonsense", 7],
        "[Linen Shirt](/p/linen-shirt)",
      ),
    ).toEqual([]);
  });
});
