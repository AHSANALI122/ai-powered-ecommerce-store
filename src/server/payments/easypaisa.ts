import { createCipheriv, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { eq, toStorage } from "@/lib/money";
import {
  PaymentProviderError,
  type CallbackVerification,
  type CreatePaymentResult,
  type InquiryResult,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentState,
  type RefundResult,
} from "@/server/payments/provider";

/**
 * Easypaisa Hosted Checkout (AD-8, SEC-6).
 *
 * The flow, and why each step exists:
 *
 *  1. We POST the shopper's browser to Easypaisa's hosted page with a request
 *     hash computed from our `hashKey`. That proves the *request* is ours.
 *  2. Easypaisa posts an IPN back to `postBackURL`. Its hash is verified with
 *     the same key. That proves the *message* is theirs — but a message can be
 *     replayed, and a hash says nothing about whether money moved.
 *  3. So before anything is marked PAID we call the Transaction Inquiry API
 *     and require it to report a successful transaction **for the right amount
 *     in the right currency**. Both checks must pass.
 *
 * The browser's return to `/checkout/return` is not part of this chain at all.
 * It polls our own order status; a forged redirect changes nothing (§10 #33).
 *
 * ---------------------------------------------------------------------------
 * STATUS: written against Easypaisa's published Hosted Checkout scheme
 * (AES-128-ECB request hash, v4 inquiry endpoint) but **not yet exercised
 * against a sandbox** — the credentials are still an open item in spec §9.
 * Every field name Easypaisa controls is in the two constant blocks below, so
 * reconciling with the sandbox is an edit there, not a rewrite. Until that
 * happens, use PAYMENT_PROVIDER="fake" for local work.
 * ---------------------------------------------------------------------------
 */

/** Field names on the request we send. */
const REQUEST_FIELDS = {
  storeId: "storeId",
  amount: "amount",
  postBackURL: "postBackURL",
  orderRefNum: "orderRefNum",
  expiryDate: "expiryDate",
  merchantHashedReq: "merchantHashedReq",
  autoRedirect: "autoRedirect",
  paymentMethod: "paymentMethod",
  emailAddr: "emailAddr",
} as const;

/** Field names Easypaisa uses on the IPN it posts back. */
const CALLBACK_FIELDS = {
  status: "status",
  description: "desc",
  orderRefNumber: "orderRefNumber",
  paymentToken: "paymentToken",
  hash: "merchantHashedResp",
} as const;

/** Statuses the IPN and the inquiry report. `0000` is Easypaisa's success code. */
const SUCCESS_CODES = new Set(["0000", "0", "SUCCESS", "PAID", "COMPLETED"]);
const PENDING_CODES = new Set(["PENDING", "IN_PROGRESS", "INITIATED"]);

function config() {
  const env = serverEnv();
  if (
    !env.EASYPAISA_STORE_ID ||
    !env.EASYPAISA_HASH_KEY ||
    !env.EASYPAISA_USERNAME ||
    !env.EASYPAISA_PASSWORD
  ) {
    throw new PaymentProviderError(
      "Easypaisa is not configured. Set EASYPAISA_STORE_ID, EASYPAISA_HASH_KEY, EASYPAISA_USERNAME and EASYPAISA_PASSWORD.",
      "EASYPAISA",
    );
  }
  return {
    storeId: env.EASYPAISA_STORE_ID,
    hashKey: env.EASYPAISA_HASH_KEY,
    username: env.EASYPAISA_USERNAME,
    password: env.EASYPAISA_PASSWORD,
    accountNum: env.EASYPAISA_ACCOUNT_NUM ?? env.EASYPAISA_STORE_ID,
    checkoutUrl: env.EASYPAISA_CHECKOUT_URL,
    inquiryUrl: env.EASYPAISA_INQUIRY_URL,
    appUrl: env.APP_URL,
  };
}

/**
 * Easypaisa's request hash: every parameter except the hash itself, sorted by
 * key, joined `k=v&k=v`, then AES-128-ECB encrypted with the 16-character
 * `hashKey` and base64-encoded.
 *
 * Exported for tests — this is the one piece of the integration whose
 * correctness can be pinned down without a sandbox.
 */
export function easypaisaHash(params: Record<string, string>, hashKey: string): string {
  const key = Buffer.from(hashKey, "utf8");
  if (key.length !== 16) {
    throw new PaymentProviderError(
      `EASYPAISA_HASH_KEY must be exactly 16 characters (got ${key.length}).`,
      "EASYPAISA",
    );
  }

  const plain = Object.keys(params)
    .filter((name) => name !== REQUEST_FIELDS.merchantHashedReq)
    .filter((name) => name !== CALLBACK_FIELDS.hash)
    .filter((name) => params[name] !== undefined && params[name] !== "")
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join("&");

  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true); // PKCS#7, which is PKCS#5 for a 16-byte block
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Easypaisa wants `DDMMYYYY HHmmss`, in Pakistan Standard Time (UTC+5). */
export function easypaisaExpiry(when: Date): string {
  const pkt = new Date(when.getTime() + 5 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${pad(pkt.getUTCDate())}${pad(pkt.getUTCMonth() + 1)}${pkt.getUTCFullYear()}` +
    ` ${pad(pkt.getUTCHours())}${pad(pkt.getUTCMinutes())}${pad(pkt.getUTCSeconds())}`
  );
}

function normaliseState(code: string | null | undefined): PaymentState {
  if (!code) return "PENDING";
  const value = code.trim().toUpperCase();
  if (SUCCESS_CODES.has(value)) return "PAID";
  if (PENDING_CODES.has(value)) return "PENDING";
  return "FAILED";
}

/** IPNs arrive as a form post; some Easypaisa configurations use JSON. */
function parseCallbackBody(
  body: string,
  contentType: string | null,
): Record<string, string> {
  const fields: Record<string, string> = {};

  if ((contentType ?? "").includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" || typeof value === "number") {
            fields[key] = String(value);
          }
        }
      }
    } catch {
      /* fall through to an empty set: an unparseable body fails verification */
    }
    return fields;
  }

  for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
  return fields;
}

export const easypaisaProvider: PaymentProvider = {
  kind: "EASYPAISA",
  label: "Easypaisa",

  async createPayment(order: PaymentOrder): Promise<CreatePaymentResult> {
    const cfg = config();

    if (order.currency !== "PKR") {
      // Easypaisa settles in PKR only. Failing here beats sending an amount
      // the provider will silently reinterpret.
      throw new PaymentProviderError(
        `Easypaisa cannot charge ${order.currency}; it settles in PKR.`,
        "EASYPAISA",
      );
    }

    const expiry = order.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000);

    const fields: Record<string, string> = {
      [REQUEST_FIELDS.storeId]: cfg.storeId,
      [REQUEST_FIELDS.amount]: toStorage(order.grandTotal),
      [REQUEST_FIELDS.postBackURL]: new URL(
        "/api/webhooks/easypaisa",
        cfg.appUrl,
      ).toString(),
      [REQUEST_FIELDS.orderRefNum]: order.orderNumber,
      [REQUEST_FIELDS.expiryDate]: easypaisaExpiry(expiry),
      [REQUEST_FIELDS.autoRedirect]: "1",
      [REQUEST_FIELDS.emailAddr]: order.email,
    };

    fields[REQUEST_FIELDS.merchantHashedReq] = easypaisaHash(fields, cfg.hashKey);

    return {
      // Easypaisa mints its own token on the hosted page; until the IPN names
      // it, our order number is the reference both sides agree on.
      providerRef: order.orderNumber,
      redirect: { method: "POST", url: cfg.checkoutUrl, fields },
    };
  },

  async verifyCallback(request: Request, body: string): Promise<CallbackVerification> {
    const cfg = config();
    const fields = parseCallbackBody(body, request.headers.get("content-type"));

    const orderNumber = fields[CALLBACK_FIELDS.orderRefNumber] ?? null;
    const providerRef = fields[CALLBACK_FIELDS.paymentToken] ?? orderNumber;
    const presented = fields[CALLBACK_FIELDS.hash];

    // No hash means the sender could not compute one, which means they do not
    // hold the key. That is the whole test.
    const verified = Boolean(
      presented && hashesMatch(presented, easypaisaHash(fields, cfg.hashKey)),
    );

    return {
      verified,
      // The payment token dedupes retries of the same IPN; Easypaisa resends
      // until it gets a 200 (WebhookEvent unique constraint, SEC-19).
      eventId: `${orderNumber ?? "unknown"}:${providerRef ?? "none"}`,
      orderNumber,
      providerRef,
      claimedState: normaliseState(fields[CALLBACK_FIELDS.status]),
      payload: fields,
    };
  },

  /**
   * The second half of AD-8. A verified hash proves the IPN is Easypaisa's; it
   * does not prove settlement, and it does not prove the amount. This asks
   * Easypaisa directly, and the caller compares the answer to the order total.
   */
  async inquire(order: PaymentOrder): Promise<InquiryResult> {
    const cfg = config();
    const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");

    const response = await fetch(cfg.inquiryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        orderId: order.orderNumber,
        storeId: cfg.storeId,
        accountNum: cfg.accountNum,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new PaymentProviderError(
        `Easypaisa inquiry failed with ${response.status}.`,
        "EASYPAISA",
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const status =
      typeof data.transactionStatus === "string" ? data.transactionStatus : null;
    const amount =
      typeof data.transactionAmount === "string" ||
      typeof data.transactionAmount === "number"
        ? toStorage(String(data.transactionAmount))
        : null;

    return {
      state: normaliseState(status),
      amount,
      // The inquiry does not name a currency; Easypaisa is PKR-only, and
      // createPayment already refused anything else.
      currency: "PKR",
      providerRef: typeof data.paymentToken === "string" ? data.paymentToken : null,
    };
  },

  /**
   * Easypaisa's Hosted Checkout package exposes no merchant refund API: a
   * reversal is raised through the merchant portal. Reporting that honestly is
   * the point — the capture path marks the order REFUNDED and queues an
   * operator notification, so an unhonourable capture is always visible rather
   * than silently kept.
   */
  async refund(order: PaymentOrder, amount: string): Promise<RefundResult> {
    console.error(
      `[easypaisa] manual refund required: order ${order.orderNumber}, amount ${toStorage(amount)}`,
    );
    return { refundRef: `manual:${order.orderNumber}`, automatic: false };
  },
};

/** Exported for the capture path's amount comparison. */
export function amountsMatch(a: string, b: string): boolean {
  return eq(a, b);
}
