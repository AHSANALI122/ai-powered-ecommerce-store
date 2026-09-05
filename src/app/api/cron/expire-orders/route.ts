import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/expire-orders (SEC-19).
 *
 * Cancels PENDING orders whose payment window has closed. **Nothing is
 * released**, because nothing was ever held: stock is taken only inside the
 * verified-paid transaction. This exists so an abandoned checkout stops
 * looking payable and stops occupying the shopper's order list — and so a
 * provider callback arriving hours late finds a non-PENDING order and is
 * correctly refused by `captureOrder`.
 *
 * `paymentStatus: PENDING` is part of the filter, so a captured order can
 * never be expired by a race between this job and a webhook.
 *
 * Vercel Cron authenticates with `Authorization: Bearer $CRON_SECRET`.
 */
const BATCH_LIMIT = 500;

function authorized(request: NextRequest): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const expectedBuffer = Buffer.from(secret, "utf8");
  const presentedBuffer = Buffer.from(presented, "utf8");
  if (expectedBuffer.length !== presentedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return jsonError("UNAUTHORIZED", "Not permitted.");
  }

  const now = new Date();
  const stale = await prisma.order.findMany({
    where: { status: "PENDING", paymentStatus: "PENDING", expiresAt: { lt: now } },
    select: { id: true },
    take: BATCH_LIMIT,
  });

  if (stale.length === 0) return jsonOk({ expired: 0 });

  // Re-asserting both statuses in the update makes the job safe to run
  // concurrently with a webhook that is capturing one of these very orders.
  const result = await prisma.order.updateMany({
    where: {
      id: { in: stale.map((order) => order.id) },
      status: "PENDING",
      paymentStatus: "PENDING",
    },
    data: { status: "EXPIRED", paymentStatus: "FAILED", cancelledAt: now },
  });

  return jsonOk({ expired: result.count });
}
