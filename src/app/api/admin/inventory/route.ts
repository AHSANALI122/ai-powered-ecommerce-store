import { z } from "zod";
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody, parseSearchParams } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import {
  ADMIN_PAGE_SIZE_DEFAULT,
  ADMIN_PAGE_SIZE_MAX,
  ADMIN_PAGE_MAX,
} from "@/lib/validation/admin/list";
import { stockUpdateSchema } from "@/lib/validation/admin/catalog";
import { listInventory, updateStock } from "@/server/admin/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / PATCH /api/admin/inventory
 *
 * The inventory view lists *variants*, because that is where stock lives
 * (AD-5), ordered by stock ascending so the shelves that need attention are on
 * page one.
 */
const inventoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(ADMIN_PAGE_MAX).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_PAGE_SIZE_MAX)
      .default(ADMIN_PAGE_SIZE_DEFAULT),
    threshold: z.coerce.number().int().min(0).max(1000).optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const parsed = parseSearchParams(request.nextUrl.searchParams, inventoryQuerySchema);
  if (!parsed.ok) return parsed.response;

  return jsonOk(await listInventory(parsed.data));
}

/**
 * Absolute counts, applied together. See `updateStock` for why an absolute
 * value is the only safe shape when a capture may be decrementing the same row.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, stockUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await updateStock(parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "inventory.update",
    target: `${result.value.updated} variant(s)`,
    detail: {
      updates: parsed.data.updates.map((update) => ({
        variantId: update.variantId,
        stock: update.stock,
      })),
    },
  });

  return jsonOk({ updated: result.value.updated });
}
