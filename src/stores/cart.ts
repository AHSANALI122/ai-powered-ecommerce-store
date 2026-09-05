"use client";

import { create } from "zustand";

/**
 * Client cart state (AD-3).
 *
 * Holds a *count* and nothing else that matters. No prices, no line items to
 * be edited, no totals — the cart the server returns is the cart, and every
 * amount in it is recomputed from the database on each read (SEC-4, SEC-11).
 * What lives here is the badge in the header, which needs to update the
 * instant something is added rather than after a round trip.
 *
 * `status` starts "unknown" so the badge can render nothing at all until the
 * real count arrives, instead of flashing a confident 0.
 */

interface CartState {
  itemCount: number;
  status: "unknown" | "ready";
  setCount: (itemCount: number) => void;
  reset: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  itemCount: 0,
  status: "unknown",
  setCount: (itemCount) => set({ itemCount, status: "ready" }),
  reset: () => set({ itemCount: 0, status: "unknown" }),
}));

/** The shape every cart endpoint returns; shared by the client components. */
export interface CartResponse {
  cart: {
    id: string | null;
    currency: string;
    itemCount: number;
    subtotal: string;
    hasIssues: boolean;
    lines: {
      id: string;
      variantId: string;
      productSlug: string;
      productTitle: string;
      image: string | null;
      size: string;
      colorName: string;
      colorHex: string;
      sku: string;
      unitPrice: string;
      quantity: number;
      lineTotal: string;
      available: number;
      issue: "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | null;
    }[];
  };
}
