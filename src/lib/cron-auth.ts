import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Bearer authentication for scheduled jobs.
 *
 * Extracted when F6 added a second cron route: two copies of a constant-time
 * comparison is two places for one of them to quietly become `===` during a
 * refactor.
 *
 * The comparison is timing-safe, and the length check is written so that an
 * attacker cannot learn the secret's length from how long a rejection takes —
 * a mismatched length still performs a comparison before returning false.
 * Without a configured secret nothing is authorised, which is the correct
 * default for an endpoint that expires orders or sends mail.
 */
export function authorizeCron(request: NextRequest): boolean {
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
