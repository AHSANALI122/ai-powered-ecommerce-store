"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { ACCEPT_ATTRIBUTE } from "@/lib/validation/admin/upload-types";
import { Button } from "@/components/admin/ui";

/**
 * Product image list with upload (F4, SEC-14).
 *
 * The `accept` attribute and any size check here are courtesies to the operator,
 * not controls: the server sniffs the bytes and enforces the byte cap
 * regardless of what the browser sent. Treating this component as the
 * validation would be the classic mistake — a `curl` never runs it.
 *
 * The first image is the one the catalogue card and the product page's LCP slot
 * use, so ordering is editable and the primary slot is labelled rather than
 * left to be inferred.
 */
export function ImageUploader({
  images,
  onChange,
  disabled,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    startTransition(async () => {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        const result = await apiFetch<{ image: { url: string } }>("/api/admin/uploads", {
          method: "POST",
          body,
        });
        if (!result.ok) {
          setError(`${file.name}: ${result.error.message}`);
          break;
        }
        uploaded.push(result.data.image.url);
      }
      if (uploaded.length > 0) onChange([...images, ...uploaded]);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function move(index: number, delta: number) {
    const next = [...images];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Images</label>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          disabled={disabled || pending}
          onChange={(event) => upload(event.target.files)}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-[var(--color-line)] file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
        />
        {pending ? (
          <span role="status" className="text-xs text-[var(--color-muted)]">
            Uploading…
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}

      {images.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">
          JPEG, PNG, WebP or AVIF. The first image is used on listing cards.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {images.map((src, index) => (
            <li
              key={src}
              className="flex w-40 flex-col gap-2 rounded-lg border border-[var(--color-line)] p-2"
            >
              <div className="relative aspect-square overflow-hidden rounded bg-black/[0.04] dark:bg-white/[0.05]">
                <Image src={src} alt="" fill sizes="160px" className="object-cover" />
              </div>
              {index === 0 ? (
                <span className="text-center text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  primary
                </span>
              ) : null}
              <div className="flex items-center justify-between gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={disabled || index === 0}
                  aria-label={`Move image ${index + 1} earlier`}
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={disabled || index === images.length - 1}
                  aria-label={`Move image ${index + 1} later`}
                  className="rounded border border-[var(--color-line)] px-2 py-0.5 disabled:opacity-40"
                >
                  →
                </button>
                <Button
                  tone="danger"
                  disabled={disabled}
                  onClick={() =>
                    onChange(images.filter((_, position) => position !== index))
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
