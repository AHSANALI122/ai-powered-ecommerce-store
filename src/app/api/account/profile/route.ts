import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, parseBody } from "@/lib/http";
import { updateProfileSchema } from "@/lib/validation/auth";
import { requireCsrf } from "@/lib/csrf";
import { requireApiUser } from "@/lib/auth/api-guard";
import { publicUser } from "@/server/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/account/profile
 *
 * The row updated is the caller's own, identified from the session cookie —
 * there is no user id in the request to tamper with (SEC-23). The schema is
 * `.strict()` and contains only `name`, so `role`, `email` or `emailVerified`
 * in the body are rejected outright rather than ignored (SEC-16).
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const csrf = requireCsrf(request);
  if (csrf) return csrf;

  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, updateProfileSchema);
  if (!parsed.ok) return parsed.response;

  const user = await prisma.user.update({
    where: { id: guard.user.id },
    data: { name: parsed.data.name },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });

  return jsonOk({ ok: true, user: publicUser(user) });
}
