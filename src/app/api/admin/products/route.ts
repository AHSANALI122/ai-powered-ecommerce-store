import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody, parseSearchParams } from "@/lib/http";
import { requireAdminRead, requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { productCreateSchema, productListSchema } from "@/lib/validation/admin/catalog";
import { createProduct, listAdminProducts } from "@/server/admin/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / POST /api/admin/products
 *
 * The listing is paginated with a capped page size and an `orderBy` chosen from
 * a whitelist inside the service (SEC-24); the create body is `.strict()`, so a
 * field the schema does not name — `ratingAvg`, `source`, `id` — is a 422 and
 * not a silent write (SEC-16).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminRead();
  if (!guard.ok) return guard.response;

  const parsed = parseSearchParams(request.nextUrl.searchParams, productListSchema);
  if (!parsed.ok) return parsed.response;

  return jsonOk(await listAdminProducts(parsed.data));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, productCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createProduct(parsed.data);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "product.create",
    target: result.value.id,
    detail: { slug: result.value.slug, variants: result.value.variants.length },
  });

  return jsonOk({ product: result.value }, { status: 201 });
}
