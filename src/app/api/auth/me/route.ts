import { NextResponse } from "next/server";
import { jsonOk } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/current-user";
import { publicUser } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — who the cookies say you are, read from the database.
 *
 * Used to rehydrate the client store after a hard navigation. Answers 200 with
 * `user: null` rather than 401: "nobody is signed in" is a normal state, not an
 * error, and a 401 here would trip generic client-side retry logic.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  return jsonOk({ user: user ? publicUser(user) : null });
}
