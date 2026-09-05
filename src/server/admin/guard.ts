import type { NextRequest } from "next/server";
import { requireApiRole } from "@/lib/auth/api-guard";
import { requireCsrf } from "@/lib/csrf";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { Guard } from "@/lib/auth/api-guard";

/**
 * The gate on every admin endpoint (SEC-7, SEC-1).
 *
 * `requireApiRole` re-reads the user row on every call, so the role that
 * authorises the request is the role in the database right now — not the one
 * baked into a JWT up to fifteen minutes ago. That is the whole of the F4 DoD
 * clause "a demoted admin loses access immediately": the proxy's `/admin`
 * check is a convenience that saves a render, this is the control.
 *
 * The two helpers differ only in CSRF, and the split is intentional rather than
 * a parameter: a reader that forgets to pass `mutation: true` fails open, while
 * a mutation that calls `requireAdminRead` is visible as the wrong function
 * name at the call site.
 */

const ADMIN_ROLES = ["STAFF", "ADMIN"] as const;

/** GET handlers. No CSRF: a safe method has nothing to forge. */
export function requireAdminRead(): Promise<Guard<CurrentUser>> {
  return requireApiRole(...ADMIN_ROLES);
}

/** Everything that writes. CSRF first — it is the cheaper rejection. */
export async function requireAdminWrite(
  request: NextRequest,
): Promise<Guard<CurrentUser>> {
  const csrf = requireCsrf(request);
  if (csrf) return { ok: false, response: csrf };
  return requireApiRole(...ADMIN_ROLES);
}
