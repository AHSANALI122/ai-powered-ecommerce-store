import type { NextResponse } from "next/server";
import { jsonError, type ErrorCode } from "@/lib/http";
import type { WriteFailure } from "@/server/admin/products";

/**
 * Maps a service-layer failure to an HTTP status.
 *
 * The messages come from the service and are written for an operator: "That SKU
 * is already in use" is actionable, and unlike the storefront's deliberately
 * generic errors (SEC-9) there is no enumeration risk in telling an
 * authenticated STAFF user that a row exists — they can already list it.
 *
 * What still never crosses this boundary is internal detail: a Prisma error, a
 * constraint name, a stack. Those stay in the logs (SEC-26).
 */
const STATUS: Record<WriteFailure, ErrorCode> = {
  NOT_FOUND: "NOT_FOUND",
  SLUG_TAKEN: "CONFLICT",
  SKU_TAKEN: "CONFLICT",
  VARIANT_EXISTS: "CONFLICT",
  CATEGORY_NOT_FOUND: "UNPROCESSABLE",
  INVALID: "UNPROCESSABLE",
};

export function writeFailure(failure: {
  reason: WriteFailure;
  message: string;
}): NextResponse {
  return jsonError(STATUS[failure.reason], failure.message);
}
