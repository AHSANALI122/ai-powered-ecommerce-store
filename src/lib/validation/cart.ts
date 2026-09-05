import { z } from "zod";

/**
 * Cart input schemas (SEC-16).
 *
 * Note what is *absent*: there is no `price`, no `unitPrice`, no `lineTotal`.
 * The client names a variant and a quantity; every amount is read from the
 * database (SEC-4). A `.strict()` schema without a price field means a
 * tampered body is rejected at the boundary rather than trusted downstream.
 */

/** cuid()s are 25 chars, but the id shape is Prisma's business — bound it only. */
export const idSchema = z.string().trim().min(1).max(64);

/**
 * One line may not exceed this many units. A cap belongs here rather than only
 * in the UI: it bounds both an accidental fat-finger and a deliberate attempt
 * to reserve a whole size run.
 */
export const MAX_LINE_QUANTITY = 20;

export const quantitySchema = z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY);

export const addCartItemSchema = z
  .object({
    variantId: idSchema,
    quantity: quantitySchema.default(1),
  })
  .strict();

export const updateCartItemSchema = z
  .object({
    /** Zero is not accepted: removing a line is a DELETE, not a quantity of 0. */
    quantity: quantitySchema,
  })
  .strict();

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
