"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";
import { useAuthStore } from "@/stores/auth";

/**
 * Sign out.
 *
 * The button cannot delete the cookies itself — they are httpOnly — so it asks
 * the server, which both clears them and revokes the refresh family in the
 * database (SEC-10). `router.refresh()` then re-renders the server tree so the
 * header reflects the change without a full reload.
 */
export function SignOutButton() {
  const router = useRouter();
  const clear = useAuthStore((state) => state.clear);
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    await postJson("/api/auth/logout", {}, { retryOnUnauthorized: false });
    clear();
    setPending(false);
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="text-sm underline underline-offset-4 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
