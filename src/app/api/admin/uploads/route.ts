import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { requireAdminWrite } from "@/server/admin/guard";
import { adminLog } from "@/server/admin/audit";
import { maxUploadBytes, putImage } from "@/server/uploads/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/uploads — multipart image upload (SEC-14).
 *
 * The only endpoint in the application that accepts something other than JSON,
 * so it is the only one `parseBody` does not fit. The validation it replaces
 * `parseBody` with is stricter, not looser:
 *
 *  - `Content-Length` is checked *before* the body is read, so an oversized
 *    upload is rejected without being buffered.
 *  - The actual bytes are checked again in `putImage` — a `Content-Length`
 *    header is a claim, not a measurement.
 *  - The type is sniffed from the leading bytes; the client's `File.type` and
 *    the uploaded filename are both discarded rather than sanitised.
 *
 * There is no URL-import counterpart to this route, deliberately. "Fetch this
 * image for me" is the SSRF half of SEC-14, and the safest version of that
 * feature is the one that does not exist.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminWrite(request);
  if (!guard.ok) return guard.response;

  const limit = maxUploadBytes();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    return jsonError(
      "UNPROCESSABLE",
      `That image is larger than ${Math.round(limit / (1024 * 1024))} MB.`,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("BAD_REQUEST", "Malformed upload.");
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return jsonError("UNPROCESSABLE", "No image was attached.");
  }

  const result = await putImage(file, file.size);
  if (!result.ok) return jsonError("UNPROCESSABLE", result.message);

  adminLog(guard.user, {
    action: "upload.create",
    target: result.value.url,
    detail: { mime: result.value.mime, size: result.value.size },
  });

  return jsonOk({ image: result.value }, { status: 201 });
}
