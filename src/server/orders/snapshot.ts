import { z } from "zod";
import { countrySchema } from "@/lib/validation/address";

/**
 * Address snapshots (spec §5).
 *
 * An order stores the address as JSON, not a foreign key, so editing or
 * deleting an address never rewrites the record of where an order was sent.
 * The schema below is the contract for that column: it validates on the way in
 * and parses on the way out, so a hand-edited row surfaces as a rendering
 * failure rather than as `undefined` in a shipping label.
 */

export const addressSnapshotSchema = z
  .object({
    fullName: z.string(),
    phone: z.string().nullable().default(null),
    line1: z.string(),
    line2: z.string().nullable().default(null),
    city: z.string(),
    state: z.string().nullable().default(null),
    postalCode: z.string().nullable().default(null),
    country: countrySchema,
  })
  .strict();

export type AddressSnapshot = z.infer<typeof addressSnapshotSchema>;

export function toAddressSnapshot(address: {
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
}): AddressSnapshot {
  return addressSnapshotSchema.parse({
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  });
}

/** Returns null rather than throwing: one malformed row must not 500 a list. */
export function readAddressSnapshot(value: unknown): AddressSnapshot | null {
  const parsed = addressSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function formatAddress(address: AddressSnapshot): string[] {
  return [
    address.fullName,
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(" "),
    address.state,
    address.country,
  ].filter((line): line is string => Boolean(line && line.trim()));
}
