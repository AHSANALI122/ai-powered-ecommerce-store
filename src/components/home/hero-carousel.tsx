"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { runtimeRoute } from "@/lib/routes";

/**
 * Home hero carousel (F2).
 *
 * Every requirement in the spec is a behaviour, not a look, so each one is
 * called out where it is implemented:
 *
 *  - **Autoplay pauses on hover and on focus-within**, so a keyboard user is
 *    never fighting a moving target.
 *  - **No autoplay at all under `prefers-reduced-motion: reduce`.** The plugin
 *    is not even created, rather than created and stopped — a plugin that is
 *    running and paused is one bug away from moving. The progress bar is not
 *    rendered either: a countdown to something that will never happen.
 *  - **Keyboard navigable** with arrow keys, real buttons, and visible focus.
 *  - **ARIA**: `aria-roledescription="carousel"`, labelled slides, and a
 *    polite live region announcing the current slide.
 *  - **LCP**: the first slide's image is `priority` + `fetchPriority="high"`
 *    and is the LCP element. Later slides lazy-load. The track sits in a fixed
 *    aspect-ratio box, so rotation causes no layout shift (CLS).
 *
 * The slide's text animates in on selection and the image holds a slow zoom
 * while its slide is the active one — both `transform`/`opacity` only, both
 * inside the fixed box, so neither can move the page.
 */

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  image: string | null;
  cta: string;
}

const AUTOPLAY_DELAY_MS = 6000;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  // Read once, before the carousel is created: the plugin list cannot be
  // changed after initialisation, and an autoplay that is created then stopped
  // is a different thing from one that never existed.
  const [reducedMotion] = useState(prefersReducedMotion);

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "start", duration: 24 },
    reducedMotion
      ? []
      : [
          Autoplay({
            delay: AUTOPLAY_DELAY_MS,
            stopOnInteraction: false,
            stopOnMouseEnter: true,
            stopOnFocusIn: true,
          }),
        ],
  );

  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext],
  );

  if (slides.length === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured collections"
      className="relative"
      onKeyDown={onKeyDown}
    >
      <div
        ref={emblaRef}
        className="overflow-hidden rounded-[calc(var(--radius-card)*1.6)] shadow-[var(--shadow-card)]"
        // Embla's viewport is the scroll container; the tabindex makes the
        // arrow-key handler reachable without a mouse.
        tabIndex={0}
      >
        <div className="flex touch-pan-y">
          {slides.map((slide, index) => {
            const active = index === selected;
            return (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slides.length}: ${slide.title}`}
                aria-hidden={!active}
                className="relative min-w-0 flex-[0_0_100%]"
              >
                <div className="relative aspect-4/5 sm:aspect-16/9 lg:aspect-21/9">
                  {slide.image ? (
                    <Image
                      src={slide.image}
                      alt=""
                      fill
                      // The first slide is the LCP candidate; the rest must not
                      // compete with it for bandwidth.
                      priority={index === 0}
                      fetchPriority={index === 0 ? "high" : "auto"}
                      loading={index === 0 ? "eager" : "lazy"}
                      sizes="(max-width: 1152px) 100vw, 1152px"
                      className={`object-cover transition-transform duration-[6000ms] ease-linear motion-reduce:transition-none ${
                        active ? "scale-105" : "scale-100"
                      }`}
                    />
                  ) : (
                    <div className="size-full bg-[var(--color-subtle)]" />
                  )}

                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/40 to-black/5"
                  />

                  <div
                    // Remounting on selection is what replays the entrance —
                    // re-applying a class to a live element would not.
                    key={active ? `active-${selected}` : "idle"}
                    className={`absolute inset-0 flex flex-col justify-end gap-3 p-6 text-white sm:p-10 ${
                      active ? "animate-fade-up" : ""
                    }`}
                  >
                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/80">
                      {slide.subtitle}
                    </p>
                    <h2 className="font-display max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
                      {slide.title}
                    </h2>
                    <Link
                      href={runtimeRoute(slide.href)}
                      // Slides that are not visible must not be focusable, or
                      // Tab walks into off-screen content.
                      tabIndex={active ? 0 : -1}
                      className="group mt-2 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-[transform,box-shadow] duration-300 ease-[var(--ease-interaction)] hover:shadow-[var(--shadow-lift)] active:translate-y-px"
                    >
                      {slide.cta}
                      <span
                        aria-hidden="true"
                        className="transition-transform duration-300 ease-[var(--ease-interaction)] group-hover:translate-x-1"
                      >
                        →
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-2">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => emblaApi?.scrollTo(index)}
              aria-label={`Go to slide ${index + 1}: ${slide.title}`}
              aria-current={index === selected}
              className="group relative h-1.5 overflow-hidden rounded-full bg-[var(--color-line)] transition-[width] duration-500 ease-[var(--ease-entrance)] aria-[current=true]:w-14 aria-[current=false]:w-6 hover:bg-[var(--color-muted)]"
            >
              {/* The autoplay countdown, drawn inside the active dot. Keyed on
                  the slide so it restarts with each rotation, and absent
                  entirely when nothing is rotating. */}
              {index === selected && !reducedMotion ? (
                <span
                  key={`progress-${selected}`}
                  aria-hidden="true"
                  className="absolute inset-0 origin-left bg-[var(--color-ink)]"
                  style={{
                    animation: `progress-sweep ${AUTOPLAY_DELAY_MS}ms linear both`,
                  }}
                />
              ) : null}
              {index === selected && reducedMotion ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-[var(--color-ink)]"
                />
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={scrollPrev}
            aria-label="Previous slide"
            className="flex size-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)] text-sm transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)] active:translate-y-px"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            onClick={scrollNext}
            aria-label="Next slide"
            className="flex size-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-elevated)] text-sm transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-interaction)] hover:border-[var(--color-ink)] hover:shadow-[var(--shadow-card)] active:translate-y-px"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      {/* Announces rotation to a screen reader without moving focus. */}
      <p className="sr-only" aria-live="polite">
        Slide {selected + 1} of {slides.length}: {slides[selected]?.title}
      </p>
    </section>
  );
}
