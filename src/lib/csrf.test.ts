import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  hasValidCsrfToken,
  isSameOriginRequest,
  isSafeMethod,
  requireCsrf,
} from "@/lib/csrf";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/cookie-names";

const ORIGIN = "http://localhost:3000";
const TOKEN = "PmtQd0FhWUJ2SlNsQXJJdmVDZlB0dw";

function makeRequest(init: {
  method?: string;
  origin?: string | null;
  fetchSite?: string | null;
  cookieToken?: string | null;
  headerToken?: string | null;
}): NextRequest {
  const headers = new Headers({ host: "localhost:3000" });
  if (init.origin) headers.set("origin", init.origin);
  if (init.fetchSite) headers.set("sec-fetch-site", init.fetchSite);
  if (init.headerToken) headers.set(CSRF_HEADER, init.headerToken);
  if (init.cookieToken) headers.set("cookie", `${CSRF_COOKIE}=${init.cookieToken}`);

  return new NextRequest(`${ORIGIN}/api/auth/login`, {
    method: init.method ?? "POST",
    headers,
  });
}

describe("isSafeMethod", () => {
  it("treats only the read verbs as safe", () => {
    expect(isSafeMethod("GET")).toBe(true);
    expect(isSafeMethod("head")).toBe(true);
    expect(isSafeMethod("POST")).toBe(false);
    expect(isSafeMethod("DELETE")).toBe(false);
  });
});

describe("isSameOriginRequest", () => {
  it("accepts a same-origin fetch", () => {
    expect(isSameOriginRequest(makeRequest({ fetchSite: "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(makeRequest({ origin: ORIGIN }))).toBe(true);
  });

  it("rejects a cross-site request even when it carries a plausible origin", () => {
    expect(
      isSameOriginRequest(makeRequest({ fetchSite: "cross-site", origin: ORIGIN })),
    ).toBe(false);
    expect(isSameOriginRequest(makeRequest({ origin: "https://evil.example" }))).toBe(
      false,
    );
  });

  it("rejects a request that proves nothing about where it came from", () => {
    // No Origin and no Sec-Fetch-Site. Every browser capable of a cross-site
    // mutation sends at least one, so absence is not evidence of innocence.
    expect(isSameOriginRequest(makeRequest({}))).toBe(false);
  });
});

describe("hasValidCsrfToken", () => {
  it("requires the cookie and the header to match", () => {
    expect(
      hasValidCsrfToken(makeRequest({ cookieToken: TOKEN, headerToken: TOKEN })),
    ).toBe(true);
  });

  it("fails when the header is missing, empty or different", () => {
    // The attacker's case: the browser attaches the cookie automatically, but
    // a cross-origin page cannot read it to populate the header.
    expect(hasValidCsrfToken(makeRequest({ cookieToken: TOKEN }))).toBe(false);
    expect(hasValidCsrfToken(makeRequest({ headerToken: TOKEN }))).toBe(false);
    expect(
      hasValidCsrfToken(makeRequest({ cookieToken: TOKEN, headerToken: "different" })),
    ).toBe(false);
  });
});

describe("requireCsrf", () => {
  it("lets a safe method through without any token", () => {
    expect(requireCsrf(makeRequest({ method: "GET" }))).toBeNull();
  });

  it("lets a valid same-origin mutation through", () => {
    expect(
      requireCsrf(
        makeRequest({ fetchSite: "same-origin", cookieToken: TOKEN, headerToken: TOKEN }),
      ),
    ).toBeNull();
  });

  it("returns 403 when either layer fails", async () => {
    const noToken = requireCsrf(makeRequest({ fetchSite: "same-origin" }));
    expect(noToken?.status).toBe(403);

    const crossSite = requireCsrf(
      makeRequest({ fetchSite: "cross-site", cookieToken: TOKEN, headerToken: TOKEN }),
    );
    expect(crossSite?.status).toBe(403);

    // The body must stay generic: no hint about which check failed (SEC-9).
    const body = (await crossSite?.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("Request rejected.");
  });
});
