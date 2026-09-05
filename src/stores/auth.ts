"use client";

import { create } from "zustand";

/**
 * Client auth state (AD-3).
 *
 * This store holds display state and nothing else. There is no token here, and
 * there never will be: tokens live in httpOnly cookies the browser cannot read.
 * Anything in this store is a hint for rendering — every authorisation decision
 * is made again on the server, against the database (SEC-7).
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
  emailVerified: boolean;
}

interface AuthState {
  user: SessionUser | null;
  /** "unknown" until the server-rendered value has been applied. */
  status: "unknown" | "authenticated" | "anonymous";
  setUser: (user: SessionUser | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "unknown",
  setUser: (user) => set({ user, status: user ? "authenticated" : "anonymous" }),
  clear: () => set({ user: null, status: "anonymous" }),
}));
