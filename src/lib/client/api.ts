"use client";

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/cookie-names";

/**
 * The browser's side of the auth contract.
 *
 * Two jobs, both of which exist because tokens live in httpOnly cookies the
 * client cannot read (AD-3):
 *
 *  1. Attach the double-submit CSRF header, read from the one cookie that is
 *     deliberately readable (SEC-1).
 *  2. On a 401, rotate once through /api/auth/refresh and replay the request.
 *     Access tokens last 15 minutes (SEC-22), so an idle tab will hit this.
 */

export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const GENERIC_ERROR: ApiError = {
  code: "INTERNAL",
  message: "Something went wrong. Try again.",
};

async function request(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  // FormData must set its own Content-Type: the multipart boundary is generated
  // by the browser, and naming the type here would send a body no parser can
  // split (F4's admin image upload is the only caller that hits this).
  if (
    init.body !== undefined &&
    !headers.has("Content-Type") &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }
  const csrf = readCsrfToken();
  if (csrf) headers.set(CSRF_HEADER, csrf);

  return fetch(path, { ...init, headers, credentials: "same-origin" });
}

/**
 * `retryOnUnauthorized` is false for the auth endpoints themselves: a failed
 * login is a real 401, and refreshing in response to it would be a pointless
 * round trip on every typo.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { retryOnUnauthorized?: boolean } = {},
): Promise<ApiResult<T>> {
  const retry = options.retryOnUnauthorized ?? true;

  let response: Response;
  try {
    response = await request(path, init);

    if (response.status === 401 && retry) {
      const refreshed = await request("/api/auth/refresh", { method: "POST" });
      if (refreshed.ok) response = await request(path, init);
    }
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as { error: ApiError }).error ?? GENERIC_ERROR)
        : GENERIC_ERROR;
    return { ok: false, error };
  }

  return { ok: true, data: payload as T };
}

export function postJson<T>(
  path: string,
  body: unknown,
  options?: { retryOnUnauthorized?: boolean },
) {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, options);
}
