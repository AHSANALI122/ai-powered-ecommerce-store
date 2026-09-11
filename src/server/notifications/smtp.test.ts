import { describe, expect, it } from "vitest";
import { classifySmtpError } from "@/server/notifications/smtp";

/**
 * The classifier decides whether a row goes back in the queue or straight to
 * FAILED, so both directions of a wrong answer are expensive: a permanent
 * rejection retried five times delays the moment anyone notices, and a
 * transient outage called permanent silently drops verification mail.
 */
describe("classifySmtpError", () => {
  it("retries a bad password instead of burning the queue", () => {
    // The case the numeric rule gets wrong on its own: Gmail answers a bad
    // App Password with 535, and 5xx alone would mark every queued row FAILED
    // the moment a secret is rotated or mistyped.
    const result = classifySmtpError({
      code: "EAUTH",
      responseCode: 535,
      message: "Username and Password not accepted",
    });

    expect(result.retryable).toBe(true);
    expect(result.message).toContain("auth");
  });

  it("does not retry a rejected envelope", () => {
    const result = classifySmtpError({
      code: "EENVELOPE",
      message: "No recipients defined",
    });

    expect(result.retryable).toBe(false);
  });

  it("retries anything that never reached the server", () => {
    for (const code of ["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET"]) {
      expect(classifySmtpError({ code, message: "boom" }).retryable).toBe(true);
    }
  });

  it("splits SMTP status codes at 500", () => {
    // 4xx is "not now" — greylisting, throttling, mailbox busy.
    expect(classifySmtpError({ responseCode: 451, message: "try later" }).retryable).toBe(
      true,
    );
    expect(classifySmtpError({ responseCode: 421, message: "busy" }).retryable).toBe(
      true,
    );
    // 5xx is "not ever" — no such user, message rejected.
    expect(
      classifySmtpError({ responseCode: 550, message: "no such user" }).retryable,
    ).toBe(false);
    expect(classifySmtpError({ responseCode: 552, message: "too big" }).retryable).toBe(
      false,
    );
  });

  it("retries an unrecognised failure", () => {
    expect(classifySmtpError(new Error("something odd")).retryable).toBe(true);
    expect(classifySmtpError(undefined).retryable).toBe(true);
    expect(classifySmtpError("nope").retryable).toBe(true);
  });

  it("always produces a message, even from a bare throw", () => {
    expect(classifySmtpError(undefined).message).toBeTruthy();
    expect(classifySmtpError({}).message).toBeTruthy();
  });
});
