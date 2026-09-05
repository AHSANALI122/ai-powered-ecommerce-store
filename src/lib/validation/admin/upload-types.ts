/**
 * The accepted image formats, in the one place both sides can import.
 *
 * The server sniffs uploaded bytes against this list
 * (`src/server/uploads/image-type.ts`); the admin file input advertises it in
 * its `accept` attribute. Keeping them in one module is what stops the picker
 * offering a format the server will then reject — and, more importantly, stops
 * anyone widening the picker and assuming the server followed.
 *
 * The browser side is a courtesy either way: `accept` is a filter in a file
 * dialog, not a control. A request that skips the dialog is still checked byte
 * by byte on arrival (SEC-14).
 */

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

export const ACCEPTED_IMAGE_TYPES: readonly ImageMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");
