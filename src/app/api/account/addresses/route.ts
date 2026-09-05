import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { addressInputSchema } from "@/lib/validation/address";
import { createAddress, listAddresses, MAX_ADDRESSES } from "@/server/addresses/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / POST /api/account/addresses
 *
 * The owner is the session's user on both verbs; the body has no `userId`
 * field to supply one (SEC-16, SEC-23).
 */
export async function GET(): Promise<NextResponse> {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  return jsonOk({ addresses: await listAddresses(guard.user.id) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, addressInputSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createAddress(guard.user.id, parsed.data);
  if (!result.ok) {
    return jsonError("CONFLICT", `You can save up to ${MAX_ADDRESSES} addresses.`);
  }

  return jsonOk({ address: result.address }, { status: 201 });
}
