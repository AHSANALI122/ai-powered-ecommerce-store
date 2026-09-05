import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * The F6 definition of done, against real Postgres.
 *
 * > A provider blip must not lose an email (outbox replay).
 *
 * Like the capture suite, the property under test belongs to the database. The
 * worker's claim is a conditional `UPDATE ... WHERE status = 'QUEUED' AND
 * next_attempt_at <= now()`, and what makes it safe is that Postgres
 * re-evaluates that predicate against the committed row when a concurrent
 * transaction commits first. Mocking Prisma would test the mock.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://... npm run test:integration
 */

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

// env.ts caches on first read and db.ts builds its client from it, so both must
// be set before either module is imported. Hence the dynamic imports below.
if (DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.EMAIL_DRIVER = "resend";
  process.env.RESEND_API_KEY = "test-key-not-used-fetch-is-stubbed";
  process.env.EMAIL_FROM = "outbox-test@example.com";
}

type Modules = {
  prisma: (typeof import("@/lib/db"))["prisma"];
  processOutbox: (typeof import("@/server/notifications/worker"))["processOutbox"];
  requeueFailed: (typeof import("@/server/notifications/worker"))["requeueFailed"];
  MAX_ATTEMPTS: (typeof import("@/server/notifications/worker"))["MAX_ATTEMPTS"];
  resetEmailSender: (typeof import("@/server/notifications/email"))["resetEmailSender"];
};

/** A Resend response of the given status, shaped enough for the driver. */
function resendResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe.skipIf(!DATABASE_URL)("email outbox against real Postgres", () => {
  let mod: Modules;
  const scope = randomUUID().slice(0, 8);
  const address = () => `outbox-${randomUUID().slice(0, 8)}@${scope}.test`;

  beforeAll(async () => {
    const [db, worker, email] = await Promise.all([
      import("@/lib/db"),
      import("@/server/notifications/worker"),
      import("@/server/notifications/email"),
    ]);
    mod = {
      prisma: db.prisma,
      processOutbox: worker.processOutbox,
      requeueFailed: worker.requeueFailed,
      MAX_ATTEMPTS: worker.MAX_ATTEMPTS,
      resetEmailSender: email.resetEmailSender,
    };
    mod.resetEmailSender();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (!mod) return;
    await mod.prisma.notification.deleteMany({
      where: { to: { endsWith: `@${scope}.test` } },
    });
    await mod.prisma.$disconnect();
  });

  /** A QUEUED row due immediately, with a unique address so we can find it. */
  async function queueRow(to = address()) {
    return mod.prisma.notification.create({
      data: {
        type: "ORDER_SHIPPED",
        status: "QUEUED",
        to,
        subject: `Order ${scope} is on its way`,
        payload: { orderNumber: scope },
        nextAttemptAt: new Date(),
      },
      select: { id: true, to: true },
    });
  }

  const read = (id: string) =>
    mod.prisma.notification.findUniqueOrThrow({ where: { id } });

  it("sends a queued row and flips it to SENT", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(resendResponse(200, { id: "re_123" }));

    const row = await queueRow();
    await mod.processOutbox();

    const after = await read(row.id);
    expect(after.status).toBe("SENT");
    expect(after.sentAt).not.toBeNull();
    // A SENT row must never look due again.
    expect(after.nextAttemptAt).toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("keeps a row QUEUED and backs it off when the provider 500s", async () => {
    // The blip. The row must survive it, scheduled rather than lost.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(500, {}));

    const row = await queueRow();
    const summary = await mod.processOutbox();

    const after = await read(row.id);
    expect(after.status).toBe("QUEUED");
    expect(after.attempts).toBe(1);
    expect(after.lastError).toContain("500");
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(summary.retrying).toBeGreaterThanOrEqual(1);
  });

  it("delivers on a later run once the provider recovers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(503, {}));
    const row = await queueRow();
    await mod.processOutbox();
    expect((await read(row.id)).status).toBe("QUEUED");

    // The outage ends. The backoff would normally hold the row, so bring it
    // forward — the schedule is the thing being simulated, not the thing
    // being tested.
    await mod.prisma.notification.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(200, { id: "re_ok" }));
    await mod.processOutbox();

    // The point of the whole design: nothing was lost, it was only delayed.
    expect((await read(row.id)).status).toBe("SENT");
  });

  it("does not retry a permanent rejection", async () => {
    // A 422 for a malformed address fails identically forever. Retrying it
    // five times only delays the moment somebody notices.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      resendResponse(422, { message: "invalid to address" }),
    );

    const row = await queueRow();
    await mod.processOutbox();

    const after = await read(row.id);
    expect(after.status).toBe("FAILED");
    expect(after.attempts).toBe(1);
    expect(after.nextAttemptAt).toBeNull();
  });

  it("gives up after MAX_ATTEMPTS of a retryable failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(500, {}));

    const row = await queueRow();
    for (let i = 0; i < mod.MAX_ATTEMPTS; i += 1) {
      await mod.processOutbox();
      // Skip the backoff so the ladder can be walked in one test.
      await mod.prisma.notification.updateMany({
        where: { id: row.id, status: "QUEUED" },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
    }

    const after = await read(row.id);
    expect(after.status).toBe("FAILED");
    expect(after.attempts).toBe(mod.MAX_ATTEMPTS);
  });

  it("replays FAILED rows on request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(500, {}));
    const row = await queueRow();
    await mod.prisma.notification.update({
      where: { id: row.id },
      data: { status: "FAILED", attempts: 5, lastError: "resend 500" },
    });

    await mod.requeueFailed();

    const requeued = await read(row.id);
    expect(requeued.status).toBe("QUEUED");
    // The count measured the previous conditions; the replay is a fresh start.
    expect(requeued.attempts).toBe(0);
    expect(requeued.lastError).toBeNull();

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(resendResponse(200, { id: "re_ok" }));
    await mod.processOutbox();
    expect((await read(row.id)).status).toBe("SENT");
  });

  it("sends a row exactly once when two workers run concurrently", async () => {
    // The claim under contention. Two overlapping cron invocations must divide
    // the batch, not duplicate it — one conditional UPDATE wins per row.
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { to: string[] };
      sent.push(body.to[0]!);
      return resendResponse(200, { id: "re_ok" });
    });

    const rows = await Promise.all([queueRow(), queueRow(), queueRow()]);
    const addresses = rows.map((row) => row.to);

    await Promise.all([mod.processOutbox(), mod.processOutbox()]);

    for (const to of addresses) {
      expect(sent.filter((entry) => entry === to)).toHaveLength(1);
    }
    for (const row of rows) {
      expect((await read(row.id)).status).toBe("SENT");
    }
  });

  it("leaves a row that is not yet due alone", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(resendResponse(200, { id: "re_ok" }));

    const row = await mod.prisma.notification.create({
      data: {
        type: "WELCOME",
        status: "QUEUED",
        to: address(),
        subject: "Welcome",
        payload: {},
        nextAttemptAt: new Date(Date.now() + 3_600_000),
      },
      select: { id: true },
    });

    await mod.processOutbox();

    expect((await read(row.id)).status).toBe("QUEUED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
