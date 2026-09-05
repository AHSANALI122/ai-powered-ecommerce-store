import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { GUEST_COOKIE } from "@/lib/auth/cookie-names";
import { getSessionClaims } from "@/lib/auth/current-user";

/**
 * Who a cart belongs to (SEC-23).
 *
 * Exactly one of two things: a signed-in user id taken from the session, or a
 * `guestId` from an httpOnly cookie. Neither is ever read from a request body,
 * so there is no cart identifier a client can substitute for somebody else's.
 *
 * The proxy issues `guestId` to every visitor, but its `Set-Cookie` only
 * reaches the *browser* — the request that triggered it still has no cookie to
 * read. A first-ever "add to cart" would therefore find nothing, so mutations
 * mint the id themselves and hand it back for the response to set.
 */

export type CartOwner =
  { kind: "user"; userId: string } | { kind: "guest"; guestId: string };

/**
 * Read-only resolution, for rendering. Returns null for a visitor who is
 * neither signed in nor carrying a guest cookie: they cannot have a cart yet,
 * and a page render is not allowed to set one.
 */
export async function readCartOwner(): Promise<CartOwner | null> {
  const claims = await getSessionClaims();
  if (claims) return { kind: "user", userId: claims.sub };

  const guestId = (await cookies()).get(GUEST_COOKIE)?.value;
  return guestId ? { kind: "guest", guestId } : null;
}

export interface MutableCartOwner {
  owner: CartOwner;
  /** Non-null when a guest id was minted here and the response must set it. */
  issuedGuestId: string | null;
}

/** Resolution for mutations, which may mint a guest identity. */
export async function resolveCartOwner(): Promise<MutableCartOwner> {
  const existing = await readCartOwner();
  if (existing) return { owner: existing, issuedGuestId: null };

  const guestId = randomUUID();
  return { owner: { kind: "guest", guestId }, issuedGuestId: guestId };
}

/** The `where` fragment that scopes every cart query to its owner. */
export function cartWhere(owner: CartOwner) {
  return owner.kind === "user" ? { userId: owner.userId } : { guestId: owner.guestId };
}
