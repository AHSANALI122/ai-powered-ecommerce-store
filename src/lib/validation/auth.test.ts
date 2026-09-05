import { describe, expect, it } from "vitest";
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "@/lib/validation/auth";

describe("registerSchema", () => {
  it("normalises the email so one address is one account", () => {
    const parsed = registerSchema.parse({
      email: "  Ahsan@Example.COM ",
      password: "correct horse 9",
    });
    expect(parsed.email).toBe("ahsan@example.com");
  });

  it("rejects an unknown field instead of ignoring it (SEC-16)", () => {
    // The whole point of .strict(): a handler that spreads the parsed body must
    // not be able to receive a role it never asked for.
    const result = registerSchema.safeParse({
      email: "a@b.com",
      password: "correct horse 9",
      role: "ADMIN",
    });
    expect(result.success).toBe(false);
  });

  it("enforces the password policy", () => {
    expect(
      registerSchema.safeParse({ email: "a@b.com", password: "short1" }).success,
    ).toBe(false);
    // Long enough but no digit.
    expect(
      registerSchema.safeParse({ email: "a@b.com", password: "alllettersonly" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ email: "a@b.com", password: "letters123456" }).success,
    ).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(
      registerSchema.safeParse({ email: "not-an-email", password: "letters123456" })
        .success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("does not apply the new-password policy to an existing password", () => {
    // A password set before a policy change must still be presentable, and
    // echoing the policy at login leaks nothing useful anyway.
    expect(loginSchema.safeParse({ email: "a@b.com", password: "old" }).success).toBe(
      true,
    );
  });

  it("still bounds the length", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(500) }).success,
    ).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("only accepts a base64url-shaped token", () => {
    const password = "letters123456";
    expect(
      resetPasswordSchema.safeParse({ token: "a".repeat(43), password }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ token: "has spaces and $", password }).success,
    ).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "short", password }).success).toBe(
      false,
    );
  });
});

describe("updateProfileSchema", () => {
  it("accepts only a name", () => {
    expect(updateProfileSchema.safeParse({ name: "Ahsan" }).success).toBe(true);
    expect(
      updateProfileSchema.safeParse({ name: "Ahsan", emailVerified: "2020-01-01" })
        .success,
    ).toBe(false);
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});
