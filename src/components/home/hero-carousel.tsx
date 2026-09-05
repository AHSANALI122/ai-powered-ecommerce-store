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
 *    running and paused is one bug away from moving.
 *  - **Keyboard navigable** with arrow keys, real buttons, and visible focus.
 *  - **ARIA**: `aria-roledescription="carousel"`, labelled slides, and a
 *    polite live region announcing the current slide.
 *  - **LCP**: the first slide's image is `priority` + `fetchPriority="high"`
 *    and is the LCP element. Later slides lazy-load. The track sits in a fixed
 *    aspect-ratio box, so rotation causes no layout shift (CLS).
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
        className="overflow-hidden rounded-xl"
        // Embla's viewport is the scroll container; the tabindex makes the
        // arrow-key handler reachable without a mouse.
        tabIndex={0}
      >
        <div className="flex touch-pan-y">
          {slides.map((slide, index) => (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${slides.length}: ${slide.title}`}
              aria-hidden={index !== selected}
              className="relative min-w-0 flex-[0_0_100%]"
            >
              <div className="relative aspect-16/9 sm:aspect-21/9">
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
                    className="object-cover"
                  />
                ) : (
                  <div className="size-full bg-black/5" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-black/10" />
                <div className="absolute inset-0 flex flex-col justify-end gap-2 p-6 text-white sm:p-10">
                  <p className="text-xs uppercase tracking-widest opacity-90">
                    {slide.subtitle}
                  </p>
                  <h2 className="max-w-lg text-2xl font-semibold tracking-tight sm:text-4xl">
                    {slide.title}
                  </h2>
                  <Link
                    href={runtimeRoute(slide.href)}
                    // Slides that are not visible must not be focusable, or Tab
                    // walks into off-screen content.
                    tabIndex={index === selected ? 0 : -1}
                    className="mt-2 w-fit rounded-md bg-white px-4 py-2 text-sm font-medium text-black"
                  >
                    {slide.cta}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => emblaApi?.scrollTo(index)}
              aria-label={`Go to slide ${index + 1}: ${slide.title}`}
              aria-current={index === selected}
              className="size-2.5 rounded-full border border-[var(--color-ink)] aria-[current=true]:bg-[var(--color-ink)]"
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={scrollPrev}
            aria-label="Previous slide"
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            ←
          </button>
          <button
            type="button"
            onClick={scrollNext}
            aria-label="Next slide"
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
          >
            →
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
