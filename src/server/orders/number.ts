import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Order numbers (SEC-29).
 *
 * Two parts, each doing a different job:
 *
 *  - a Postgres sequence (`order_number_seq`, created in the baseline
 *    migration) guarantees uniqueness under concurrency. `nextval` is atomic
 *    and non-transactional, so two simultaneous checkouts cannot collide the
 *    way a `MAX(orderNumber) + 1` read would.
 *  - four random characters stop the sequence from being a public counter.
 *    Without them, order `AC-1041-` tells a competitor exactly how many orders
 *    the store took this week, and lets anyone guess a neighbouring order id.
 *
 * The result is still short enough to read down a phone line.
 */

const PREFIX = "AC";
/** Crockford-ish: no I, L, O, U — nothing a customer can mis-transcribe. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSuffix(length = 4): string {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return suffix;
}

export async function nextOrderNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<{ nextval: bigint | number | string }[]>`
    SELECT nextval('order_number_seq') AS nextval
  `;

  const value = rows[0]?.nextval;
  if (value === undefined) {
    throw new Error(
      "order_number_seq returned nothing; is the baseline migration applied?",
    );
  }

  return `${PREFIX}-${String(value)}-${randomSuffix()}`;
}
