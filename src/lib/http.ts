import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Response conventions for every route handler.
 *
 * Error bodies are `{ error: { code, message } }` with generic, non-revealing
 * messages. Internal detail (stack traces, Prisma errors, whether an email
 * exists) never crosses this boundary — it goes to logs (SEC-9, SEC-26).
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function jsonError(
  code: ErrorCode,
  message: string,
  init?: ResponseInit & { fieldErrors?: Record<string, string[]> },
): NextResponse {
  const { fieldErrors, ...responseInit } = init ?? {};
  return NextResponse.json(
    { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } },
    { status: STATUS[code], ...responseInit },
  );
}

/**
 * Parses and validates a JSON request body (SEC-16).
 *
 * Pair with a `.strict()` object schema so unknown fields are rejected rather
 * than silently ignored — that is what stops a client from smuggling
 * `role: "ADMIN"` or `price: 1` into a handler.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("BAD_REQUEST", "Malformed JSON body.") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError("UNPROCESSABLE", "Validation failed.", {
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      }),
    };
  }

  return { ok: true, data: parsed.data };
}

/** Same contract as parseBody, for URLSearchParams (listings, filters). */
export function parseSearchParams<S extends z.ZodType>(
  params: URLSearchParams,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; response: NextResponse } {
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length > 1 ? values : (values[0] ?? "");
  }

  const parsed = schema.safeParse(record);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError("BAD_REQUEST", "Invalid query parameters.", {
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      }),
    };
  }
  return { ok: true, data: parsed.data };
}
