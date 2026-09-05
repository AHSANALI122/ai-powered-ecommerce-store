import { describe, expect, it } from "vitest";
import {
  generateOpaqueToken,
  hashToken,
  safeEqual,
  signAccessToken,
  verifyAccessToken,
} from "@/lib/auth/tokens";

describe("access tokens", () => {
  const claims = {
    sub: "user_123",
    role: "CUSTOMER",
    ev: true,
    fam: "family_1",
  } as const;

  it("round-trips its claims", async () => {
    const token = await signAccessToken(claims);
    await expect(verifyAccessToken(token)).resolves.toEqual(claims);
  });

  it("rejects a tampered payload", async () => {
    const token = await signAccessToken(claims);
    const [header, payload, signature] = token.split(".");
    const forged = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    // The exact escalation SEC-7 exists to stop: claim ADMIN and re-sign
    // nothing. Without signature verification this would be a free promotion.
    forged.role = "ADMIN";
    const rebuilt = [
      header,
      Buffer.from(JSON.stringify(forged)).toString("base64url"),
      signature,
    ].join(".");

    await expect(verifyAccessToken(rebuilt)).resolves.toBeNull();
  });

  it("rejects an unsigned (alg: none) token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: "user_123", role: "ADMIN", ev: true, fam: "f" }),
    ).toString("base64url");
    await expect(verifyAccessToken(`${header}.${payload}.`)).resolves.toBeNull();
  });

  it("rejects nonsense rather than throwing", async () => {
    await expect(verifyAccessToken("not-a-token")).resolves.toBeNull();
    await expect(verifyAccessToken("")).resolves.toBeNull();
  });
});

describe("opaque tokens", () => {
  it("produces url-safe values that do not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically and irreversibly in shape", () => {
    const raw = generateOpaqueToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).not.toContain(raw);
  });
});

describe("safeEqual", () => {
  it("matches identical strings and nothing else", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    // Different lengths must not throw — timingSafeEqual does on mismatch.
    expect(safeEqual("abc", "abcdef")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
