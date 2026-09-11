"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The product gallery (F2 polish).
 *
 * A client component, but note what it is *not* doing: it reads no cookie, no
 * search param and no session, so the route it sits in stays prerendered. The
 * first image is still rendered on the server with `priority`, which is what
 * keeps it the LCP element — swapping images is the only thing hydration adds.
 *
 * Every image is in the DOM from the start, stacked and cross-faded with
 * opacity. That is deliberate: the alternative — swapping the `src` of one
 * `<img>` — shows the shopper a blank box for as long as the new file takes to
 * arrive, and the whole point of a gallery is that looking at the next photo
 * should be instant. Only the first is eager; the rest are lazy, so the extra
 * images cost nothing until the browser is idle.
 */
export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="aspect-3/4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-subtle)]" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="group relative aspect-3/4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-subtle)]">
        {images.map((image, index) => (
          <Image
            key={image}
            src={image}
            alt={index === 0 ? title : ""}
            fill
            // The LCP element on this route is the first frame; the others must
            // not compete with it.
            priority={index === 0}
            fetchPriority={index === 0 ? "high" : "auto"}
            loading={index === 0 ? "eager" : "lazy"}
            sizes="(max-width: 1024px) 100vw, 50vw"
            aria-hidden={index !== active}
            className={`object-cover transition-[opacity,transform] duration-500 ease-[var(--ease-entrance)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
              index === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>

      {images.length > 1 ? (
        <ul className="grid grid-cols-5 gap-3">
          {images.slice(0, 5).map((image, index) => (
            <li key={image}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-pressed={index === active}
                aria-label={`Show image ${index + 1} of ${Math.min(images.length, 5)}`}
                className="relative block aspect-square w-full overflow-hidden rounded-md border transition-[border-color,transform,box-shadow] duration-300 ease-[var(--ease-interaction)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] aria-[pressed=true]:border-[var(--color-ink)] aria-[pressed=false]:border-[var(--color-line)]"
              >
                <Image
                  src={image}
                  alt=""
                  fill
                  loading="lazy"
                  sizes="12vw"
                  className="object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
