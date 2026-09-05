/**
 * The launch gate (SEC-27, F6).
 *
 * Demo products carry `source = "pexels"`. They exist so a fresh clone has a
 * catalogue to develop against; shipping them is shipping stock photography of
 * clothes nobody can send, under prices nobody set, to customers who can order
 * them. This is the one command that removes them.
 *
 *   npx tsx --env-file=.env scripts/purge-seed-data.ts          # report only
 *   npx tsx --env-file=.env scripts/purge-seed-data.ts --confirm # delete
 *
 * Two deliberate properties:
 *
 *  - **Dry run by default.** A destructive script whose safe mode requires a
 *    flag is a script that eventually runs without one. `--confirm` is the
 *    flag, and it is required for the deletion, not for the report.
 *  - **It refuses when a seeded product has been ordered.** `OrderItem.
 *    productId` is `SetNull` on delete, so history survives the purge — but a
 *    real order against a demo product means someone was sold one, and that
 *    is a fact an operator has to see before the evidence is removed.
 *    `--force` overrides, having been told.
 */
import { prisma } from "../src/lib/db";

const SEED_SOURCE = "pexels";

const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const forced = args.has("--force");

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !confirmed) {
    console.log("Running against a production database. Nothing will be deleted without --confirm.\n");
  }

  const products = await prisma.product.count({ where: { source: SEED_SOURCE } });
  const variants = await prisma.productVariant.count({
    where: { product: { source: SEED_SOURCE } },
  });
  const reviews = await prisma.review.count({
    where: { product: { source: SEED_SOURCE } },
  });
  const wishlisted = await prisma.wishlistItem.count({
    where: { product: { source: SEED_SOURCE } },
  });
  // `OrderItem.productId` is a bare nullable column with no relation — the
  // snapshot fields are the identity of a historical line, deliberately not a
  // join — so this counts against the ids rather than filtering through one.
  const seededIds = await prisma.product.findMany({
    where: { source: SEED_SOURCE },
    select: { id: true },
  });
  const ordered = await prisma.orderItem.count({
    where: { productId: { in: seededIds.map((row) => row.id) } },
  });

  console.log(`Seeded products (source="${SEED_SOURCE}"): ${products}`);
  console.log(`  variants:        ${variants}   (cascade)`);
  console.log(`  reviews:         ${reviews}   (cascade)`);
  console.log(`  wishlist rows:   ${wishlisted}   (cascade)`);
  console.log(`  order items:     ${ordered}   (productId set to null; history kept)`);

  if (products === 0) {
    console.log("\nNothing to purge. The catalogue is clean.");
    return;
  }

  if (ordered > 0 && !forced) {
    console.error(
      `\nRefusing: ${ordered} order item(s) reference demo products — someone was sold one.\n` +
        `Review those orders first. Re-run with --force once you have.`,
    );
    process.exitCode = 1;
    return;
  }

  if (!confirmed) {
    console.log("\nDry run. Re-run with --confirm to delete.");
    return;
  }

  const result = await prisma.product.deleteMany({ where: { source: SEED_SOURCE } });
  console.log(`\nDeleted ${result.count} demo products.`);
  console.log(
    "Remaining launch steps: replace the placeholder imagery in public/, and " +
      "confirm no product still points at images.pexels.com.",
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
