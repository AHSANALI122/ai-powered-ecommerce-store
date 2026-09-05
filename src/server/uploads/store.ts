import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/env";
import { detectImageType, type ImageMimeType } from "@/server/uploads/image-type";

/**
 * Admin image upload (F4, SEC-14).
 *
 * Modelled on `PaymentProvider`: one interface, several drivers, one selected
 * by env, and the development-only driver refused at boot in production
 * (`IMAGE_STORE=local`, see env.ts) exactly as `PAYMENT_PROVIDER=fake` is.
 *
 * The security-relevant part is all in `putImage`, and it is short on purpose:
 *
 *  - **The bytes are read fully before anything is written**, and both the
 *    declared length and the received length are checked against the cap. A
 *    lying `Content-Length` buys nothing.
 *  - **The type is sniffed from those bytes** (image-type.ts). The uploaded
 *    filename is discarded outright rather than sanitised — there is nothing to
 *    escape if it is never used.
 *  - **The stored name is random**, so an upload cannot overwrite an earlier
 *    one, cannot be guessed, and cannot collide between two admins.
 *  - **Nothing is fetched.** There is no "import from URL" path anywhere in
 *    F4: the server never dereferences an address a user supplied, which is the
 *    SSRF half of SEC-14.
 */

export interface StoredImage {
  /** What goes in `Product.images`: a same-origin path or an https CDN URL. */
  url: string;
  mime: ImageMimeType;
  size: number;
}

export type UploadFailure =
  | { ok: false; reason: "TOO_LARGE"; message: string }
  | { ok: false; reason: "UNSUPPORTED_TYPE"; message: string }
  | { ok: false; reason: "EMPTY"; message: string };

export type UploadResult = { ok: true; value: StoredImage } | UploadFailure;

interface ImageStore {
  readonly kind: "local" | "blob";
  save(bytes: Uint8Array, key: string, mime: ImageMimeType): Promise<string>;
}

/**
 * Development driver. Writes under `public/uploads`, which Next serves
 * statically — fine on one developer's machine, useless on Vercel where the
 * filesystem is read-only and per-instance. `env.ts` refuses this driver in
 * production rather than letting an upload appear to succeed and then 404.
 */
const localStore: ImageStore = {
  kind: "local",
  async save(bytes, key) {
    const directory = path.join(process.cwd(), "public", "uploads");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, key), bytes);
    return `/uploads/${key}`;
  },
};

/**
 * Production driver. `access: "public"` because these are catalogue images
 * served to anonymous shoppers; `addRandomSuffix: false` because the key is
 * already 16 random bytes and a second layer of randomness only makes the URL
 * harder to reconcile with the row that references it.
 */
const blobStore: ImageStore = {
  kind: "blob",
  async save(bytes, key, mime) {
    const { put } = await import("@vercel/blob");
    const result = await put(`products/${key}`, Buffer.from(bytes), {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
      token: serverEnv().BLOB_READ_WRITE_TOKEN,
    });
    return result.url;
  },
};

function activeStore(): ImageStore {
  return serverEnv().IMAGE_STORE === "blob" ? blobStore : localStore;
}

export function maxUploadBytes(): number {
  return serverEnv().UPLOAD_MAX_BYTES;
}

function describeLimit(): string {
  return `${Math.round(maxUploadBytes() / (1024 * 1024))} MB`;
}

/**
 * Validates and stores one image. `declaredSize` is the browser's claim (from
 * `File.size` or Content-Length) and is used only to reject early — the real
 * check is against the bytes that arrived.
 */
export async function putImage(file: Blob, declaredSize?: number): Promise<UploadResult> {
  const limit = maxUploadBytes();

  if (declaredSize !== undefined && declaredSize > limit) {
    return {
      ok: false,
      reason: "TOO_LARGE",
      message: `That image is larger than ${describeLimit()}.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength === 0) {
    return { ok: false, reason: "EMPTY", message: "That file is empty." };
  }
  // The authoritative size check: whatever was declared, this is what arrived.
  if (bytes.byteLength > limit) {
    return {
      ok: false,
      reason: "TOO_LARGE",
      message: `That image is larger than ${describeLimit()}.`,
    };
  }

  const detected = detectImageType(bytes);
  if (!detected) {
    return {
      ok: false,
      reason: "UNSUPPORTED_TYPE",
      message: "Upload a JPEG, PNG, WebP or AVIF image.",
    };
  }

  const key = `${randomBytes(16).toString("hex")}${detected.extension}`;
  const url = await activeStore().save(bytes, key, detected.mime);

  return { ok: true, value: { url, mime: detected.mime, size: bytes.byteLength } };
}
