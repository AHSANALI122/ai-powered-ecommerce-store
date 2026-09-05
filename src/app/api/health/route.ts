import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { jsonOk } from "@/lib/http";
import { NextResponse } from "next/server";

/** Never cached: a cached health check is not a health check. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Check = { status: "ok" | "error" | "skipped"; latencyMs?: number };

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const started = Date.now();
  try {
    await fn();
    return { status: "ok", latencyMs: Date.now() - started };
  } catch {
    // Detail goes to logs, not the response — this endpoint is public.
    return { status: "error", latencyMs: Date.now() - started };
  }
}

export async function GET(): Promise<NextResponse> {
  const database = await timed(() => prisma.$queryRaw`SELECT 1`);

  const redisClient = getRedis();
  const redis: Check = redisClient
    ? await timed(() => redisClient.ping())
    : { status: "skipped" };

  const healthy = database.status === "ok" && redis.status !== "error";

  const body = {
    status: healthy ? ("ok" as const) : ("degraded" as const),
    checks: { database, redis },
    timestamp: new Date().toISOString(),
  };

  return healthy ? jsonOk(body) : NextResponse.json(body, { status: 503 });
}
