/**
 * Image type detection by content, not by claim (SEC-14).
 *
 * A browser's `File.type` and a filename's extension are both attacker-supplied
 * strings. `evil.php.jpg` with `Content-Type: image/jpeg` is a text file with a
 * flattering name; trusting either is how an upload endpoint becomes a file-drop.
 * So the bytes decide, and the extension the file is finally stored under is
 * derived from the *sniffed* type — the uploaded name never reaches the disk.
 *
 * The allowed set is four raster formats. Two notable exclusions:
 *
 *  - **SVG.** It is an XML document that may carry `<script>`, and it is served
 *    from the site's own origin, so an accepted SVG is a stored XSS with a
 *    Content-Security-Policy that trusts `'self'`. It also has no magic number,
 *    which means the sniffing below rejects it without a special case.
 *  - **GIF.** Nothing in a clothing catalogue needs one, and every format the
 *    store accepts is a format someone has to keep thinking about.
 */

import {
  ACCEPTED_IMAGE_TYPES,
  type ImageMimeType,
} from "@/lib/validation/admin/upload-types";

export type { ImageMimeType };

export interface DetectedImage {
  mime: ImageMimeType;
  /** Includes the leading dot. Derived from `mime`, never from the upload. */
  extension: string;
}

const EXTENSIONS: Record<ImageMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/** Re-exported so a reader of the sniffer can see the list it enforces. */
export { ACCEPTED_IMAGE_TYPES };

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Returns the detected type, or null when the bytes are not one of the four
 * accepted formats. Null is a rejection, never a "probably fine".
 */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  // JPEG: SOI marker.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", extension: EXTENSIONS["image/jpeg"] };
  }

  // PNG: the 8-byte signature, including the CRLF/EOF traps.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", extension: EXTENSIONS["image/png"] };
  }

  // WebP: a RIFF container whose form type is "WEBP". Both halves must match —
  // "RIFF" alone is also a .wav.
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { mime: "image/webp", extension: EXTENSIONS["image/webp"] };
  }

  // AVIF: an ISO-BMFF box whose major brand is avif (still) or avis (sequence).
  if (
    asciiAt(bytes, 4, "ftyp") &&
    (asciiAt(bytes, 8, "avif") || asciiAt(bytes, 8, "avis"))
  ) {
    return { mime: "image/avif", extension: EXTENSIONS["image/avif"] };
  }

  return null;
}

/** How many leading bytes `detectImageType` can possibly need. */
export const SNIFF_BYTES = 16;
