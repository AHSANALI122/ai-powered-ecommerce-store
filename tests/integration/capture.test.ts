import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * The F3 definition of done, against real Postgres.
 *
 * > two concurrent checkouts for the last unit → exactly one PAID + one clean
 * > rejection; double-click creates one order.
 *
 * This cannot be unit-tested. The property under test *is* the database's:
 * a conditional `UPDATE ... WHERE stock >= qty` re-evaluates its predicate
 * against the committed row when a concurrent transaction commits first, which
 * is what makes oversell impossible without a lock (SEC-5, AD-7). Mocking
 * Prisma here would test the mock's concurrency semantics, not Postgres's.
 *
 * Set INTEGRATION_DATABASE_URL to a **disposable** database with the
 * migrations applied and run `npm run test:integration`. Without it the suite
 * skips, so `npm test` stays runnable with no Postgres.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://... npm run test:integration
 */

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

// env.ts caches on first read and db.ts builds its client from it, so the URL
// must be in place before either module is imported. Hence dynamic imports.
if (DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.PAYMENT_PROVIDER = "fake";
}

type Modules = {
  prisma: (typeof import("@/lib/db"))["prisma"];
  captureOrder: (typeof import("@/server/orders/capture"))["captureOrder"];
  handleProviderCallback: (typeof import("@/server/orders/webhook"))["handleProviderCallback"];
  recordSandboxPayment: (typeof import("@/server/payments/fake"))["recordSandboxPayment"];
  sandboxCallbackBody: (typeof import("@/server/payments/fake"))["sandboxCallbackBody"];
};

describe.skipIf(!DATABASE_URL)("capture against real Postgres", () => {
  let mod: Modules;
  const scope = randomUUID().slice(0, 8);
  const created = { userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    const [db, capture, webhook, fake] = await Promise.all([
      import("@/lib/db"),
      import("@/server/orders/capture"),
      import("@/server/orders/webhook"),
      import("@/server/payments/fake"),
    ]);
    mod = {
      prisma: db.prisma,
      captureOrder: capture.captureOrder,
      handleProviderCallback: webhook.handleProviderCallback,
      recordSandboxPayment: fake.recordSandboxPayment,
      sandboxCallbackBody: fake.sandboxCallbackBody,
    };
  });

  afterAll(async () => {
    if (!mod) return;
    // Orders cascade to their items; carts and sessions cascade from the user.
    await mod.prisma.order.deleteMany({
      where: { email: { endsWith: `@${scope}.test` } },
    });
    await mod.prisma.webhookEvent.deleteMany({ where: { eventId: { contains: scope } } });
    await mod.prisma.setting.deleteMany({ where: { key: { contains: scope } } });
    await mod.prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    await mod.prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
    // The category this run created; it would otherwise show up in the site nav.
    await mod.prisma.category.deleteMany({ where: { slug: `itest-${scope}` } });
    await mod.prisma.$disconnect();
  });

  /** A category, a product and one variant holding exactly `stock` units. */
  async function seedVariant(stock: number, price = "1000.00") {
    const suffix = randomUUID().slice(0, 8);
    const category = await mod.prisma.category.upsert({
      where: { slug: `itest-${scope}` },
      create: { slug: `itest-${scope}`, name: "Integration test" },
      update: {},
      select: { id: true },
    });

    const product = await mod.prisma.product.create({
      data: {
        slug: `itest-product-${suffix}`,
        title: "Integration test product",
        description: "Created by the capture integration test.",
        basePrice: price,
        categoryId: category.id,
        images: [],
        variants: {
          create: {
            size: "M",
            colorName: "Black",
            colorHex: "#000000",
            sku: `ITEST-${suffix}`,
            stock,
          },
        },
      },
      select: { id: true, variants: { select: { id: true } } },
    });

    created.productIds.push(product.id);
    const variantId = product.variants[0]?.id;
    if (!variantId) throw new Error("seed failed to create a variant");
    return { productId: product.id, variantId, price };
  }

  async function seedUser() {
    const user = await mod.prisma.user.create({
      data: {
        email: `buyer-${randomUUID().slice(0, 8)}@${scope}.test`,
        passwordHash: "not-a-real-hash",
        emailVerified: new Date(),
      },
      select: { id: true, email: true },
    });
    created.userIds.push(user.id);
    return user;
  }

  /**
   * A PENDING order for one unit of `variantId`, with the sandbox provider's
   * ledger already reporting a settled payment — i.e. exactly the state a
   * verified callback finds when it arrives.
   */
  async function seedPaidPendingOrder(params: {
    variantId: string;
    productId: string;
    userId: string;
    email: string;
    price: string;
    quantity?: number;
  }) {
    const quantity = params.quantity ?? 1;
    const total = (Number(params.price) * quantity).toFixed(2);

    const order = await mod.prisma.order.create({
      data: {
        orderNumber: `ITEST-${scope}-${randomUUID().slice(0, 8)}`,
        userId: params.userId,
        email: params.email,
        currency: "PKR",
        subtotal: total,
        shippingTotal: "0.00",
        taxTotal: "0.00",
        grandTotal: total,
        shippingAddress: {
          fullName: "Test Buyer",
          phone: null,
          line1: "1 Test Road",
          line2: null,
          city: "Karachi",
          state: null,
          postalCode: null,
          country: "PK",
        },
        provider: "FAKE",
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        items: {
          create: {
            variantId: params.variantId,
            productId: params.productId,
            productTitle: "Integration test product",
            productSlug: "itest-product",
            variantSize: "M",
            variantColorName: "Black",
            variantColorHex: "#000000",
            sku: `ITEST-${randomUUID().slice(0, 8)}`,
            unitPrice: params.price,
            quantity,
            lineTotal: total,
          },
        },
      },
      select: {
        id: true,
        orderNumber: true,
        email: true,
        currency: true,
        grandTotal: true,
        expiresAt: true,
        providerRef: true,
      },
    });

    // The sandbox provider's ledger now reports a settled payment for the full
    // amount — exactly the state `inquire` finds when a verified callback lands.
    await mod.recordSandboxPayment(
      {
        id: order.id,
        orderNumber: order.orderNumber,
        email: order.email,
        currency: order.currency,
        grandTotal: order.grandTotal.toString(),
        expiresAt: order.expiresAt,
        providerRef: order.providerRef,
      },
      "PAID",
    );

    return order;
  }

  it("lets exactly one of two concurrent captures take the last unit", async () => {
    const { variantId, productId, price } = await seedVariant(1);
    const [buyerA, buyerB] = await Promise.all([seedUser(), seedUser()]);

    const [orderA, orderB] = await Promise.all([
      seedPaidPendingOrder({
        variantId,
        productId,
        userId: buyerA.id,
        email: buyerA.email,
        price,
      }),
      seedPaidPendingOrder({
        variantId,
        productId,
        userId: buyerB.id,
        email: buyerB.email,
        price,
      }),
    ]);

    const results = await Promise.all([
      mod.captureOrder({ orderNumber: orderA.orderNumber }),
      mod.captureOrder({ orderNumber: orderB.orderNumber }),
    ]);

    const outcomes = results.map((result) => result.outcome).sort();
    // One takes the unit; the other is refunded rather than oversold.
    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === "PAID")).toHaveLength(1);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome === "OUT_OF_STOCK_REFUNDED" || outcome === "OUT_OF_STOCK_REFUND_FAILED",
      ),
    ).toHaveLength(1);

    // Stock reaches zero and never goes below it.
    const variant = await mod.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant.stock).toBe(0);

    const orders = await mod.prisma.order.findMany({
      where: { orderNumber: { in: [orderA.orderNumber, orderB.orderNumber] } },
      select: { paymentStatus: true },
    });
    expect(orders.filter((order) => order.paymentStatus === "PAID")).toHaveLength(1);
    expect(orders.filter((order) => order.paymentStatus === "REFUNDED")).toHaveLength(1);
  });

  it("decrements stock once when the same webhook is delivered twice", async () => {
    const { variantId, productId, price } = await seedVariant(5);
    const buyer = await seedUser();
    const order = await seedPaidPendingOrder({
      variantId,
      productId,
      userId: buyer.id,
      email: buyer.email,
      price,
      quantity: 2,
    });

    const body = mod.sandboxCallbackBody(order.orderNumber, "paid");
    const request = new Request("http://localhost/api/webhooks/fake", { method: "POST" });

    const first = await mod.handleProviderCallback("FAKE", request, body);
    const second = await mod.handleProviderCallback("FAKE", request, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The WebhookEvent unique constraint absorbs the redelivery.
    expect(second.body.outcome).toBe("duplicate");

    const variant = await mod.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant.stock).toBe(3);
  });

  it("refuses an unsigned callback", async () => {
    const { variantId, productId, price } = await seedVariant(1);
    const buyer = await seedUser();
    const order = await seedPaidPendingOrder({
      variantId,
      productId,
      userId: buyer.id,
      email: buyer.email,
      price,
    });

    // A forged body naming a real order, with a bogus signature.
    const forged = JSON.stringify({
      orderNumber: order.orderNumber,
      outcome: "paid",
      signature: "0".repeat(64),
    });
    const request = new Request("http://localhost/api/webhooks/fake", { method: "POST" });

    const result = await mod.handleProviderCallback("FAKE", request, forged);

    expect(result.status).toBe(400);
    const stored = await mod.prisma.order.findUniqueOrThrow({
      where: { orderNumber: order.orderNumber },
      select: { paymentStatus: true },
    });
    expect(stored.paymentStatus).toBe("PENDING");

    const variant = await mod.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant.stock).toBe(1);
  });
});
