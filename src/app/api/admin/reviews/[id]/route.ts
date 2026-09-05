import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonOk, parseBody } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { writeFailure } from "@/server/admin/respond";
import { adminLog } from "@/server/admin/audit";
import { reviewModerationSchema } from "@/lib/validation/admin/operations";
import { moderateReview } from "@/server/admin/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/reviews/[id]
 *
 * Approving or rejecting recomputes the product's cached `ratingAvg` /
 * `ratingCount` in the same transaction as the verdict, so the two can never be
 * observed disagreeing (F6's requirement, enforced here because this is where
 * the verdict is written).
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/reviews/[id]">,
): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const parsed = await parseBody(request, reviewModerationSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await ctx.params;
  const result = await moderateReview(id, parsed.data.status);
  if (!result.ok) return writeFailure(result);

  adminLog(guard.user, {
    action: "review.moderate",
    target: id,
    detail: {
      status: result.value.status,
      productId: result.value.productId,
      ratingAvg: result.value.ratingAvg,
      ratingCount: result.value.ratingCount,
    },
  });

  return jsonOk({ review: result.value });
}
