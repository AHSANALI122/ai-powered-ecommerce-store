import { prisma } from "@/lib/db";
import { toStorage } from "@/lib/money";
import type {
  ShippingRateCreateInput,
  ShippingRateUpdateInput,
  ShippingZoneCreateInput,
  ShippingZoneUpdateInput,
} from "@/lib/validation/admin/operations";
import type { WriteResult } from "@/server/admin/products";

/**
 * Shipping zone and rate administration (F4).
 *
 * Nothing here is cached and nothing here is revalidated, which is deliberate:
 * shipping is quoted at checkout by `buildQuote`, reading the live rows every
 * time (SEC-11). A stale shipping charge is the one kind of stale number that
 * would reach an actual charge, so these rows are never allowed into a cache in
 * the first place.
 *
 * The catch-all zone (`countries: ["*"]`) is what stops a shopper in an
 * unlisted country from reaching checkout and finding no way to pay. It is not
 * enforced as a constraint — a store may legitimately ship nowhere while it is
 * being set up — but `listShippingZones` reports whether one exists so the
 * screen can say so out loud.
 */

export interface AdminShippingRate {
  id: string;
  zoneId: string;
  name: string;
  price: string;
  freeOver: string | null;
  minDays: number;
  maxDays: number;
  isActive: boolean;
}

export interface AdminShippingZone {
  id: string;
  name: string;
  countries: string[];
  position: number;
  isActive: boolean;
  isCatchAll: boolean;
  rates: AdminShippingRate[];
}

export interface ShippingOverview {
  zones: AdminShippingZone[];
  /** False means shoppers outside every listed country cannot check out. */
  hasActiveCatchAll: boolean;
}

const RATE_SELECT = {
  id: true,
  zoneId: true,
  name: true,
  price: true,
  freeOver: true,
  minDays: true,
  maxDays: true,
  isActive: true,
} as const;

function toRate(row: {
  id: string;
  zoneId: string;
  name: string;
  price: { toString(): string };
  freeOver: { toString(): string } | null;
  minDays: number;
  maxDays: number;
  isActive: boolean;
}): AdminShippingRate {
  return {
    id: row.id,
    zoneId: row.zoneId,
    name: row.name,
    price: toStorage(row.price.toString()),
    freeOver: row.freeOver === null ? null : toStorage(row.freeOver.toString()),
    minDays: row.minDays,
    maxDays: row.maxDays,
    isActive: row.isActive,
  };
}

export async function listShippingZones(): Promise<ShippingOverview> {
  const rows = await prisma.shippingZone.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      countries: true,
      position: true,
      isActive: true,
      rates: { orderBy: { price: "asc" }, select: RATE_SELECT },
    },
  });

  const zones = rows.map((row) => ({
    id: row.id,
    name: row.name,
    countries: row.countries,
    position: row.position,
    isActive: row.isActive,
    isCatchAll: row.countries.includes("*"),
    rates: row.rates.map(toRate),
  }));

  return {
    zones,
    hasActiveCatchAll: zones.some(
      (zone) =>
        zone.isCatchAll && zone.isActive && zone.rates.some((rate) => rate.isActive),
    ),
  };
}

export async function createShippingZone(
  input: ShippingZoneCreateInput,
): Promise<WriteResult<{ id: string }>> {
  const zone = await prisma.shippingZone.create({
    data: {
      name: input.name,
      countries: input.countries,
      position: input.position,
      isActive: input.isActive,
    },
    select: { id: true },
  });
  return { ok: true, value: zone };
}

export async function updateShippingZone(
  id: string,
  input: ShippingZoneUpdateInput,
): Promise<WriteResult<{ id: string }>> {
  const updated = await prisma.shippingZone.updateMany({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.countries !== undefined ? { countries: input.countries } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  if (updated.count === 0) {
    return { ok: false, reason: "NOT_FOUND", message: "Shipping zone not found." };
  }
  return { ok: true, value: { id } };
}

/** Rates cascade with the zone (`onDelete: Cascade`), so this removes both. */
export async function deleteShippingZone(
  id: string,
): Promise<WriteResult<{ name: string }>> {
  const zone = await prisma.shippingZone.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!zone)
    return { ok: false, reason: "NOT_FOUND", message: "Shipping zone not found." };

  await prisma.shippingZone.delete({ where: { id } });
  return { ok: true, value: { name: zone.name } };
}

export async function createShippingRate(
  input: ShippingRateCreateInput,
): Promise<WriteResult<AdminShippingRate>> {
  const zone = await prisma.shippingZone.findUnique({
    where: { id: input.zoneId },
    select: { id: true },
  });
  if (!zone)
    return { ok: false, reason: "NOT_FOUND", message: "Shipping zone not found." };

  const rate = await prisma.shippingRate.create({
    data: {
      zoneId: input.zoneId,
      name: input.name,
      price: toStorage(input.price),
      freeOver: input.freeOver == null ? null : toStorage(input.freeOver),
      minDays: input.minDays,
      maxDays: input.maxDays,
      isActive: input.isActive,
    },
    select: RATE_SELECT,
  });
  return { ok: true, value: toRate(rate) };
}

export async function updateShippingRate(
  id: string,
  input: ShippingRateUpdateInput,
): Promise<WriteResult<AdminShippingRate>> {
  const existing = await prisma.shippingRate.findUnique({
    where: { id },
    select: { minDays: true, maxDays: true },
  });
  if (!existing) return { ok: false, reason: "NOT_FOUND", message: "Rate not found." };

  // A partial update can violate the min/max relation across the two values
  // even when each one is individually valid, so re-check against the merge.
  const minDays = input.minDays ?? existing.minDays;
  const maxDays = input.maxDays ?? existing.maxDays;
  if (maxDays < minDays) {
    return {
      ok: false,
      reason: "INVALID",
      message: "The longest estimate cannot be shorter than the shortest.",
    };
  }

  const rate = await prisma.shippingRate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.price !== undefined ? { price: toStorage(input.price) } : {}),
      ...(input.freeOver !== undefined
        ? { freeOver: input.freeOver == null ? null : toStorage(input.freeOver) }
        : {}),
      ...(input.minDays !== undefined ? { minDays: input.minDays } : {}),
      ...(input.maxDays !== undefined ? { maxDays: input.maxDays } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: RATE_SELECT,
  });
  return { ok: true, value: toRate(rate) };
}

export async function deleteShippingRate(
  id: string,
): Promise<WriteResult<{ name: string }>> {
  const rate = await prisma.shippingRate.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!rate) return { ok: false, reason: "NOT_FOUND", message: "Rate not found." };

  // Orders snapshot `shippingMethod` as text, so removing a rate cannot rewrite
  // what a past order was charged for delivery.
  await prisma.shippingRate.delete({ where: { id } });
  return { ok: true, value: { name: rate.name } };
}
