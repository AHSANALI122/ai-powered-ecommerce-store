import { describe, expect, it } from "vitest";
import { detectImageType } from "@/server/uploads/image-type";

/**
 * Content sniffing (SEC-14).
 *
 * The whole reason this function exists is that `Content-Type` and a filename
 * are both things the uploader chose. These tests therefore never mention
 * either — they hand the sniffer bytes and ask what it concludes.
 */

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string, pad = 0): Uint8Array {
  const out = new Uint8Array(text.length + pad);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index);
  }
  return out;
}

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);

/** "RIFF" + 4 size bytes + "WEBP". */
function webp(): Uint8Array {
  const out = new Uint8Array(16);
  out.set(ascii("RIFF"), 0);
  out.set(ascii("WEBP"), 8);
  return out;
}

/** 4 size bytes + "ftyp" + a major brand. */
function isoBmff(brand: string): Uint8Array {
  const out = new Uint8Array(16);
  out.set(ascii("ftyp"), 4);
  out.set(ascii(brand), 8);
  return out;
}

describe("detectImageType", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg", ".jpg"],
    ["PNG", PNG, "image/png", ".png"],
    ["WebP", webp(), "image/webp", ".webp"],
    ["AVIF still", isoBmff("avif"), "image/avif", ".avif"],
    ["AVIF sequence", isoBmff("avis"), "image/avif", ".avif"],
  ])("detects %s", (_label, input, mime, extension) => {
    expect(detectImageType(input)).toEqual({ mime, extension });
  });

  /**
   * SVG is the one that matters. It is an XML document that can carry a
   * `<script>`, it is served from the site's own origin, and the CSP trusts
   * `'self'` — so an accepted SVG is stored XSS aimed at whoever opens the
   * product page. It has no magic number, so it falls out here for free.
   */
  it("rejects an SVG however it is dressed up", () => {
    expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectImageType(ascii('<?xml version="1.0"?><svg>'))).toBeNull();
    expect(detectImageType(ascii("   <svg>"))).toBeNull();
  });

  it.each([
    ["HTML", ascii("<!doctype html><script>alert(1)</script>")],
    ["PHP", ascii("<?php system($_GET['c']); ?>")],
    ["a shell script", ascii("#!/bin/sh\nrm -rf /\n")],
    ["an ELF binary", bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00)],
    ["a ZIP/JAR", bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00)],
    ["a GIF, which is deliberately not accepted", ascii("GIF89a\x00\x00")],
    ["empty input", bytes()],
  ])("rejects %s", (_label, input) => {
    expect(detectImageType(input)).toBeNull();
  });

  it("rejects a RIFF container that is not WebP", () => {
    // "RIFF....WAVE" — the prefix matches, the form type does not.
    const wav = new Uint8Array(16);
    wav.set(ascii("RIFF"), 0);
    wav.set(ascii("WAVE"), 8);
    expect(detectImageType(wav)).toBeNull();
  });

  it("rejects an ISO-BMFF container that is not AVIF", () => {
    expect(detectImageType(isoBmff("mp42"))).toBeNull();
    expect(detectImageType(isoBmff("qt  "))).toBeNull();
  });

  it("rejects a truncated signature rather than reading past the buffer", () => {
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(detectImageType(ascii("RIFF"))).toBeNull();
  });

  it("gives the extension by sniffed type, never by anything the caller said", () => {
    // A PNG uploaded as "photo.jpg" is stored as .png, because the bytes decide.
    expect(detectImageType(PNG)?.extension).toBe(".png");
  });
});
