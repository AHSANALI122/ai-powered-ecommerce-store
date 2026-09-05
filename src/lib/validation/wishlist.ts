import { z } from "zod";
import { idSchema, quantitySchema } from "@/lib/validation/cart";

/**
 * Wishlist input schemas (SEC-16, F6).
 *
 * No `userId` anywhere, in either direction: the owner comes from the session
 * in the route handler, exactly as it does for the cart and for the assistant's
 * `addToCart` tool. A body that could name a user is a body that can be aimed
 * at somebody else's list (SEC-23).
 *
 * A wishlist entry is per *product*, not per variant — "I want this coat", not
 * "I want this coat in M/navy". The variant is chosen at the moment it moves
 * to the cart, which is also the moment stock starts to matter (AD-5).
 */

export const addWishlistItemSchema = z.object({ productId: idSchema }).strict();

/**
 * Moving to the cart.
 *
 * `variantId` is optional: from a product page the shopper has already picked
 * a size and colour, while from the wishlist page they usually have not, and
 * the server then picks the first in-stock variant. Either way the server
 * verifies the variant belongs to the wishlisted product — an unchecked
 * variant id would turn "move to cart" into "add any item in the catalogue",
 * which is a lesser version of the same bug SEC-4 is about.
 */
export const moveToCartSchema = z
  .object({
    productId: idSchema,
    variantId: idSchema.optional(),
    quantity: quantitySchema.default(1),
  })
  .strict();

export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;
export type MoveToCartInput = z.infer<typeof moveToCartSchema>;
