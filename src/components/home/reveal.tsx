"use client";

import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scroll-reveal for the homepage sections (F6 polish).
 *
 * **The rendered markup must not depend on `useReducedMotion()`.** That hook
 * returns `null` during server rendering and the real media-query value on the
 * client's first render, so branching the returned tree on it — even just
 * "wrapper or no wrapper" — is a guaranteed hydration mismatch for anyone who
 * has the preference set. The wrapper is therefore unconditional and the
 * `initial` state is identical for everybody; the preference only selects
 * *which props* drive the animation, and props are not markup.
 *
 * The three other constraints, all NFR rather than taste:
 *
 * **It must not touch LCP.** The hero owns the largest paint on this page and
 * is deliberately not wrapped: an element that starts at `opacity: 0` cannot
 * be the LCP element until it has animated in, which would turn a fast paint
 * into a slow one. Only the sections below it reveal.
 *
 * **It must not cause CLS.** Only `opacity` and `transform` move. Both are
 * composited and neither affects layout, so the section occupies its full
 * height from first paint and only its appearance changes.
 *
 * **It must respect `prefers-reduced-motion`.** `globals.css` neutralises CSS
 * transitions under that query, but a JS animation library writes inline
 * styles and sails straight past it — so the preference is read explicitly.
 * Reduced motion gets `animate` rather than `whileInView`: the content
 * resolves to visible on mount regardless of scroll position, instantly. Not a
 * faster reveal — no reveal, which is what the preference asks for.
 *
 * `LazyMotion` with the `domAnimation` feature set and the `m` component keeps
 * this to a few kilobytes rather than pulling the whole library into the
 * homepage bundle.
 */
export function Reveal({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const reduced = useReducedMotion();

  const behaviour = reduced
    ? // Visible as soon as the component mounts, wherever it sits on the page.
      { animate: { opacity: 1, y: 0 }, transition: { duration: 0 } }
    : {
        whileInView: { opacity: 1, y: 0 },
        // `once` matters: re-animating on every scroll past is what makes a
        // page feel unusable rather than considered.
        //
        // `amount` is an IntersectionObserver threshold, and a fractional one
        // is a fraction of *the element*, not of the viewport — so a section
        // taller than `viewport / amount` can never satisfy it and stays at
        // `opacity: 0` forever. That is a phone-only failure: these sections
        // collapse to a two-column grid on a small screen and grow several
        // times taller than they are on a desktop. `"some"` is threshold 0 —
        // any part visible — so it cannot be outgrown.
        viewport: { once: true, amount: "some" as const },
        transition: { duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] as const },
      };

  return (
    <LazyMotion features={domAnimation} strict>
      {/* The hidden state is server-rendered, so without JavaScript nothing
          would ever reveal it. This is the whole no-JS fallback: the rule only
          exists when scripting is off, and then the content is simply
          visible. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: ".js-reveal{opacity:1!important;transform:none!important}",
          }}
        />
      </noscript>

      <m.div
        className="js-reveal"
        initial={{ opacity: 0, y: 16 }}
        {...behaviour}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
