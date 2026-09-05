import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { easypaisaExpiry, easypaisaHash } from "@/server/payments/easypaisa";

/**
 * Easypaisa's request/response hash and its expiry format.
 *
 * The sandbox credentials that would let the whole flow be exercised are still
 * an open item (spec §9), so what is pinned here is what can be: the hash is
 * deterministic, order-independent, key-sensitive, and excludes the hash field
 * itself — the last of which is what makes verifying an inbound IPN by
 * recomputation possible at all.
 */

const KEY = "0123456789ABCDEF"; // exactly 16 characters, as Easypaisa requires

function decrypt(base64: string, key = KEY): string {
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
  return Buffer.concat([
    decipher.update(Buffer.from(base64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

describe("easypaisaHash", () => {
  const params = {
    storeId: "12345",
    amount: "1500.00",
    orderRefNum: "AC-1001-K7QF",
    postBackURL: "https://example.test/api/webhooks/easypaisa",
    expiryDate: "20250905 120000",
  };

  it("is deterministic for the same input", () => {
    expect(easypaisaHash(params, KEY)).toBe(easypaisaHash(params, KEY));
  });

  it("sorts parameters by key, so field order cannot change the hash", () => {
    const reordered = {
      expiryDate: params.expiryDate,
      postBackURL: params.postBackURL,
      amount: params.amount,
      storeId: params.storeId,
      orderRefNum: params.orderRefNum,
    };
    expect(easypaisaHash(reordered, KEY)).toBe(easypaisaHash(params, KEY));
  });

  it("encrypts the sorted k=v&k=v string", () => {
    expect(decrypt(easypaisaHash(params, KEY))).toBe(
      "amount=1500.00" +
        "&expiryDate=20250905 120000" +
        "&orderRefNum=AC-1001-K7QF" +
        "&postBackURL=https://example.test/api/webhooks/easypaisa" +
        "&storeId=12345",
    );
  });

  it("changes when any value changes", () => {
    // The property the whole scheme rests on: an amount edited in flight
    // cannot keep a valid hash.
    const tampered = { ...params, amount: "1.00" };
    expect(easypaisaHash(tampered, KEY)).not.toBe(easypaisaHash(params, KEY));
  });

  it("changes when the key changes", () => {
    expect(easypaisaHash(params, "FEDCBA9876543210")).not.toBe(
      easypaisaHash(params, KEY),
    );
  });

  it("excludes the hash fields themselves, so an IPN can be re-verified", () => {
    const withHashes = {
      ...params,
      merchantHashedReq: "ignored",
      merchantHashedResp: "ignored",
    };
    expect(easypaisaHash(withHashes, KEY)).toBe(easypaisaHash(params, KEY));
  });

  it("skips empty values, which Easypaisa omits from the signed set", () => {
    expect(easypaisaHash({ ...params, emailAddr: "" }, KEY)).toBe(
      easypaisaHash(params, KEY),
    );
  });

  it("rejects a hash key that is not 16 characters", () => {
    // AES-128 needs exactly 128 bits. Failing loudly beats signing with a
    // silently truncated or padded key and debugging it against a sandbox.
    expect(() => easypaisaHash(params, "too-short")).toThrow(/16 characters/);
  });
});

describe("easypaisaExpiry", () => {
  it("formats as DDMMYYYY HHmmss in Pakistan Standard Time", () => {
    // 2025-09-05T07:30:00Z is 12:30:00 PKT (UTC+5) on the same day.
    expect(easypaisaExpiry(new Date("2025-09-05T07:30:00Z"))).toBe("05092025 123000");
  });

  it("rolls the date forward when UTC+5 crosses midnight", () => {
    expect(easypaisaExpiry(new Date("2025-09-05T20:00:00Z"))).toBe("06092025 010000");
  });

  it("zero-pads single-digit components", () => {
    expect(easypaisaExpiry(new Date("2025-01-02T00:04:05Z"))).toBe("02012025 050405");
  });
});
