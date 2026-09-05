import { z } from "zod";
import { adminListSchema } from "@/lib/validation/admin/list";
import { priceSchema, optionalPriceSchema } from "@/lib/validation/admin/catalog";
import { countrySchema } from "@/lib/validation/address";

/**
 * Order, review, shipping and settings input for the admin dashboard
 * (SEC-16, SEC-24).
 *
 * The order schema is the interesting one. It accepts a *target status* and
 * nothing else — no totals, no payment status, no paid-at. An operator moves an
 * order along its lifecycle; they do not get to declare that money arrived.
 * PAID is set by `captureOrder` behind a verified provider signal and by
 * nothing else (SEC-6, AD-8), so there is deliberately no field here that could
 * ask for it.
 */

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * The statuses an operator may move an order *to*. `PENDING` and `EXPIRED` are
 * absent because they are lifecycle states the system assigns, not destinations
 * a human picks. The legal transitions between them live in the service, which
 * is the only place that knows where the order is now.
 */
export const adminOrderStatuses = [
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export const orderStatusUpdateSchema = z
  .object({
    status: z.enum(adminOrderStatuses),
    /** Recorded in the transition log; not shown to the customer. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const orderListSchema = adminListSchema([
  "placedAt",
  "grandTotal",
  "orderNumber",
] as const).extend({
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "EXPIRED",
      "REFUNDED",
    ])
    .optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]).optional(),
});

// ---------------------------------------------------------------------------
// Review moderation
// ---------------------------------------------------------------------------

export const reviewModerationSchema = z
  .object({
    /**
     * Only the moderation verdict. A moderator does not edit the rating: doing
     * so would silently rewrite a customer's opinion and desynchronise the
     * cached aggregate from the rows it is supposed to summarise.
     */
    status: z.enum(["APPROVED", "REJECTED", "PENDING"]),
  })
  .strict();

export const reviewListSchema = adminListSchema(["createdAt", "rating"] as const).extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  productId: z.string().trim().min(1).max(64).optional(),
});

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

/**
 * `["*"]` is the catch-all zone (spec §5). Everything else is an explicit list
 * of ISO alpha-2 codes, normalised to upper case by `countrySchema` so `pk` and
 * `PK` cannot resolve to two different zones and therefore two different
 * shipping charges.
 */
const countriesSchema = z
  .array(z.union([z.literal("*"), countrySchema]))
  .min(1)
  .max(250)
  .transform((values) => Array.from(new Set(values)))
  .refine(
    (values) => values.length === 1 || !values.includes("*"),
    'The catch-all zone is ["*"] on its own.',
  );

const zoneFields = {
  name: z.string().trim().min(1).max(80),
  countries: countriesSchema,
  position: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
} as const;

export const shippingZoneCreateSchema = z.object(zoneFields).strict();

export const shippingZoneUpdateSchema = z
  .object({
    ...zoneFields,
    position: z.coerce.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

const rateFields = {
  zoneId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  price: priceSchema,
  /** Order subtotal at or above which this rate costs nothing. null disables it. */
  freeOver: optionalPriceSchema.optional(),
  minDays: z.coerce.number().int().min(0).max(365).default(3),
  maxDays: z.coerce.number().int().min(0).max(365).default(10),
  isActive: z.boolean().default(true),
} as const;

export const shippingRateCreateSchema = z
  .object(rateFields)
  .strict()
  .refine((value) => value.maxDays >= value.minDays, {
    message: "The longest estimate cannot be shorter than the shortest.",
    path: ["maxDays"],
  });

export const shippingRateUpdateSchema = z
  .object({
    ...rateFields,
    minDays: z.coerce.number().int().min(0).max(365),
    maxDays: z.coerce.number().int().min(0).max(365),
    isActive: z.boolean(),
  })
  .partial()
  .omit({ zoneId: true })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." })
  .refine(
    (value) =>
      value.minDays === undefined ||
      value.maxDays === undefined ||
      value.maxDays >= value.minDays,
    {
      message: "The longest estimate cannot be shorter than the shortest.",
      path: ["maxDays"],
    },
  );

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The tax rate as a decimal fraction: `0.18`, not `18`. The upper bound is 1
 * because the difference between those two is the difference between an 18%
 * tax and an 1800% one, and the mistake is one keystroke wide.
 */
export const taxRateUpdateSchema = z
  .object({
    rate: z
      .union([z.string(), z.number()])
      .transform((value) => (typeof value === "number" ? value.toString() : value.trim()))
      .pipe(
        z
          .string()
          .regex(
            /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/,
            "Use a fraction between 0 and 1, e.g. 0.18 for 18%.",
          ),
      ),
  })
  .strict();

export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;
export type OrderListQuery = z.infer<typeof orderListSchema>;
export type ReviewModerationInput = z.infer<typeof reviewModerationSchema>;
export type ReviewListQuery = z.infer<typeof reviewListSchema>;
export type ShippingZoneCreateInput = z.infer<typeof shippingZoneCreateSchema>;
export type ShippingZoneUpdateInput = z.infer<typeof shippingZoneUpdateSchema>;
export type ShippingRateCreateInput = z.infer<typeof shippingRateCreateSchema>;
export type ShippingRateUpdateInput = z.infer<typeof shippingRateUpdateSchema>;
export type TaxRateUpdateInput = z.infer<typeof taxRateUpdateSchema>;
