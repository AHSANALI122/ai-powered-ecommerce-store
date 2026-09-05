"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/client/api";
import { useAuthStore, type SessionUser } from "@/stores/auth";

/**
 * Loads the session into the client store, once per page load.
 *
 * Why the browser asks instead of the server telling it: reading `cookies()`
 * anywhere in the server tree opts the whole route into dynamic rendering.
 * That is the right trade for /account, and the wrong one for a product page
 * that should be ISR-cached and shared by every visitor (F2, SEC-11). Keeping
 * identity out of the server-rendered shell is what lets the catalogue stay
 * cacheable.
 *
 * The store is display state only — the server re-derives identity from the
 * httpOnly cookie on every request that matters (AD-3, SEC-7).
 */
export function SessionLoader() {
  const status = useAuthStore((state) => state.status);
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    if (status !== "unknown") return;
    let cancelled = false;

    void (async () => {
      const result = await apiFetch<{ user: SessionUser | null }>(
        "/api/auth/me",
        {},
        { retryOnUnauthorized: false },
      );
      if (cancelled) return;
      setUser(result.ok ? result.data.user : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [status, setUser]);

  return null;
}
