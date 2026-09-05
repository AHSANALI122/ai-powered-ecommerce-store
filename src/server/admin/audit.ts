import type { CurrentUser } from "@/lib/auth/current-user";

/**
 * Admin action log (F4: "guarded, logged status transitions").
 *
 * This writes structured lines to the platform log rather than to a table, and
 * that is a deliberate limit rather than an oversight. The schema is fixed
 * through F6 (`prisma/schema.prisma` already carries the F5/F6 entities so no
 * later migration is needed) and it has no `AuditLog` model, so a durable,
 * queryable trail is a schema change that belongs to whoever decides on a
 * retention policy — not something to slip in under a dashboard feature.
 *
 * What this does give is the thing the DoD actually needs: every privileged
 * mutation names its actor, its target and what changed, on one line, in a
 * shape a log drain can filter (`[admin]` prefix, JSON payload). Vercel retains
 * function logs, so "who cancelled this order" is answerable today.
 *
 * Nothing here throws. A failure to log must never roll back the action that
 * was logged — the reverse of the notification outbox, where the record *is*
 * the deliverable.
 */

export type AdminAction =
  | "product.create"
  | "product.update"
  | "product.delete"
  | "variant.create"
  | "variant.update"
  | "variant.delete"
  | "inventory.update"
  | "category.create"
  | "category.update"
  | "category.delete"
  | "order.status"
  | "review.moderate"
  | "shipping.zone.create"
  | "shipping.zone.update"
  | "shipping.zone.delete"
  | "shipping.rate.create"
  | "shipping.rate.update"
  | "shipping.rate.delete"
  | "settings.update"
  | "upload.create";

export interface AdminLogEntry {
  action: AdminAction;
  /** The row acted on: a product id, an order number, a variant SKU. */
  target: string;
  /** Small, non-sensitive detail — what changed, not the whole row. */
  detail?: Record<string, unknown>;
}

/**
 * `actor` is the user object the route guard read *from the database*, not a
 * JWT claim and never a request field, so the recorded identity is the one the
 * authorisation check actually used (SEC-7).
 */
export function adminLog(actor: CurrentUser, entry: AdminLogEntry): void {
  try {
    console.info(
      `[admin] ${entry.action}`,
      JSON.stringify({
        at: new Date().toISOString(),
        actorId: actor.id,
        actorRole: actor.role,
        action: entry.action,
        target: entry.target,
        ...(entry.detail ? { detail: entry.detail } : {}),
      }),
    );
  } catch {
    /* logging must never break the operation it describes */
  }
}
