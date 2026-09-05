import { z } from "zod";
import { idSchema } from "@/lib/validation/cart";

/**
 * Address input schemas (SEC-16, SEC-23).
 *
 * There is no `userId` field. Ownership is taken from the session on every
 * call, so there is nothing in the body to point at somebody else's row —
 * which is the shape that makes IDOR impossible rather than merely checked.
 */

/**
 * ISO 3166-1 alpha-2, uppercased. Shipping-zone resolution matches on this
 * exact form, so normalising here means `pk` and `PK` cannot resolve to
 * different zones and therefore different shipping charges.
 */
export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a two-letter country code.");

const line = (max: number) => z.string().trim().min(1).max(max);

/**
 * The field set, defined once. `isDefault` is deliberately *not* part of it:
 * on create it carries a default, and on update it must stay genuinely
 * optional — a `.default()` survives `.partial()` and would make every empty
 * PATCH body look like a real one.
 */
const addressFields = {
  fullName: line(120),
  phone: z.string().trim().min(5).max(32).optional(),
  line1: line(160),
  line2: z.string().trim().max(160).optional(),
  city: line(80),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(24).optional(),
  country: countrySchema,
} as const;

export const addressInputSchema = z
  .object({ ...addressFields, isDefault: z.boolean().default(false) })
  .strict();

/** PATCH accepts any subset, but never an empty body. */
export const addressUpdateSchema = z
  .object({ ...addressFields, isDefault: z.boolean() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update.",
  });

export const addressIdSchema = z.object({ id: idSchema }).strict();

export type AddressInput = z.infer<typeof addressInputSchema>;
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;
