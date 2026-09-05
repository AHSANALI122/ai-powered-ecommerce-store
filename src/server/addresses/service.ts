import { prisma } from "@/lib/db";
import type { AddressInput, AddressUpdateInput } from "@/lib/validation/address";

/**
 * Address book (F3, SEC-23).
 *
 * `userId` is a parameter of every function and appears in every `where`. The
 * update and delete paths use `updateMany`/`deleteMany` so an id belonging to
 * another account matches zero rows rather than being fetched and then
 * compared — a check that cannot be forgotten because there is nothing to
 * check.
 */

export interface AddressView {
  id: string;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

const SELECT = {
  id: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isDefault: true,
} as const;

/** Cap: an address book is a convenience, not unbounded user storage. */
export const MAX_ADDRESSES = 20;

export async function listAddresses(userId: string): Promise<AddressView[]> {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: SELECT,
  });
}

export async function getDefaultAddress(userId: string): Promise<AddressView | null> {
  const addresses = await listAddresses(userId);
  return addresses[0] ?? null;
}

export type AddressResult =
  | { ok: true; address: AddressView }
  | { ok: false; reason: "LIMIT_REACHED" | "NOT_FOUND" };

/**
 * "Default" is a single-winner flag, so setting one must clear the others.
 * Both writes go in a transaction: a crash between them would leave an account
 * with two defaults and a checkout screen picking arbitrarily.
 */
export async function createAddress(
  userId: string,
  input: AddressInput,
): Promise<AddressResult> {
  const count = await prisma.address.count({ where: { userId } });
  if (count >= MAX_ADDRESSES) return { ok: false, reason: "LIMIT_REACHED" };

  // The first address is the default whether or not the shopper said so.
  const isDefault = input.isDefault || count === 0;

  const address = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.create({
      data: {
        userId,
        fullName: input.fullName,
        phone: input.phone ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country,
        isDefault,
      },
      select: SELECT,
    });
  });

  return { ok: true, address };
}

export async function updateAddress(
  userId: string,
  id: string,
  input: AddressUpdateInput,
): Promise<AddressResult> {
  const owned = await prisma.address.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) return { ok: false, reason: "NOT_FOUND" };

  const address = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.line1 !== undefined ? { line1: input.line1 } : {}),
        ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
      select: SELECT,
    });
  });

  return { ok: true, address };
}

/**
 * Orders snapshot their address (spec §5), so deleting one never touches
 * order history. If the default goes, the newest survivor takes over rather
 * than leaving the account with none.
 */
export async function deleteAddress(userId: string, id: string): Promise<boolean> {
  const deleted = await prisma.address.deleteMany({ where: { id, userId } });
  if (deleted.count === 0) return false;

  const remaining = await prisma.address.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, isDefault: true },
  });
  if (remaining && !remaining.isDefault) {
    const anyDefault = await prisma.address.count({ where: { userId, isDefault: true } });
    if (anyDefault === 0) {
      await prisma.address.update({
        where: { id: remaining.id },
        data: { isDefault: true },
      });
    }
  }

  return true;
}
