import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Reveal } from "@/components/home/reveal";

/**
 * The hydration invariant (F6 polish).
 *
 * `useReducedMotion()` returns `null` while the server renders and the real
 * media-query value on the client's first render. So any component that lets
 * that value reach its *markup* — the element it returns, or a style it sets —
 * produces one tree on the server and a different one during hydration, and
 * React reports a mismatch for every visitor who has the preference enabled.
 *
 * This suite renders the component under both answers and asserts the HTML is
 * byte-identical. The preference is allowed to change the animation props
 * (`animate` versus `whileInView`, and the duration); props are not markup.
 *
 * Written after exactly that bug: an early version returned bare children when
 * reduced motion was on and a wrapper when it was off.
 */

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => mockReducedMotion };
});

let mockReducedMotion: boolean | null = null;

function renderWith(reduced: boolean | null): string {
  mockReducedMotion = reduced;
  return renderToStaticMarkup(
    <Reveal delay={0.05}>
      <section className="test-child">content</section>
    </Reveal>,
  );
}

describe("Reveal", () => {
  it("renders identical markup whether or not reduced motion is set", () => {
    // null is what the server sees; true and false are what a client sees.
    const onServer = renderWith(null);
    const reducedClient = renderWith(true);
    const fullMotionClient = renderWith(false);

    expect(reducedClient).toBe(onServer);
    expect(fullMotionClient).toBe(onServer);
  });

  it("always wraps the children in the same element", () => {
    // The specific failure that caused the bug: no wrapper in one branch.
    for (const reduced of [null, true, false] as const) {
      const html = renderWith(reduced);
      expect(html).toContain('class="js-reveal"');
      expect(html).toContain("test-child");
    }
  });

  it("server-renders the hidden state, so the reveal has somewhere to come from", () => {
    expect(renderWith(null)).toContain("opacity:0");
  });

  it("ships a no-JS fallback that makes the hidden state visible", () => {
    // Without this, a browser with scripting off would render the sections
    // permanently invisible — the cost of server-rendering `opacity: 0`.
    const html = renderWith(null);
    expect(html).toContain("<noscript>");
    expect(html).toContain("opacity:1!important");
  });
});
