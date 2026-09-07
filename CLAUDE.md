# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A production-grade global clothing store with an agentic AI shopping assistant. `spec.md` is the authoritative design document: §1–§7 (overview, stack, ADRs, data model, security requirements SEC-1…SEC-29, NFRs) are shared context for every session; §8 lists features F0→F6 built **one at a time, in order**. Read §1–§7 plus the single feature section you are working on.

**F0–F6 are complete.** The one deliberate gap is Sentry/analytics, which needs an account and a DSN (spec §8 F6). Build order was `F0 → F1/F2 → F3/F4 → F5 → F6`. Each feature section carries its own _Depends on_, _Entities_, _Security focus_ (SEC ids) and a **DoD** — treat the DoD as the acceptance test.

The implementation plan for F0–F3 lives at `~/.claude/plans/read-the-spec-md-and-lazy-quilt.md`.

## Environment requirements

- **Node ≥ 22.12** (Prisma 7 refuses to install below 20.19/22.12/24). Developed on 24.19.0.
- `prisma` must stay pinned to `^7`: the package's `latest` dist-tag currently points at an `8.0.0-rc`.
- TypeScript is pinned to `^6`, not 7 — `typescript-eslint` does not support the TS 7 API yet, so `npm run lint` breaks on 7 even though `tsc` succeeds.

## Commands

```bash
npm run dev              # next dev
npm run build            # production build (CI gate)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # vitest run (unit; DB-backed suites skip themselves)
npm run test:watch
INTEGRATION_DATABASE_URL=postgresql://... npm run test:integration   # capture concurrency vs real Postgres
npx vitest run src/lib/money.test.ts -t "rounds half away from zero"   # single test

npm run db:migrate       # prisma migrate dev   (local schema change)
npm run db:deploy        # prisma migrate deploy (release path — never `db push` in prod, SEC-28)
npm run db:seed          # ~53 demo products; refuses to run when NODE_ENV=production (SEC-27)
npm run db:studio
npm run check:public-env # SEC-12 gate: no secret may carry a NEXT_PUBLIC_ prefix
npm run purge:seed       # SEC-27 launch gate: reports; deletes only with -- --confirm
```

The admin dashboard lives at `/admin` and needs a STAFF or ADMIN user; there is
no self-service path to one, by design. Promote an account by hand:

```bash
npx tsx --env-file=.env -e 'const {prisma}=await import("./src/lib/db.ts"); await prisma.user.update({where:{email:"you@example.com"},data:{role:"ADMIN"}}); process.exit(0)'
```

Transactional email needs `EMAIL_DRIVER="resend"` plus `RESEND_API_KEY` and an
`EMAIL_FROM` on a domain verified with Resend. Development defaults to
`EMAIL_DRIVER="log"`, which prints each message and reports success so the whole
outbox lifecycle works with no provider; `env.ts` refuses it in production.

The outbox is drained by `/api/cron/send-notifications` (Bearer `CRON_SECRET`,
every two minutes in `vercel.json`). **Nothing sends without that job running**,
and nothing runs it on a development machine — a queued verification email just
stays QUEUED, which looks like broken email when the row was written correctly.
Locally, drain it with the script instead:

```bash
npm run mail:send                # drain once
npm run mail:watch               # poll every 5s, run alongside `next dev`
npm run mail:send -- --replay    # requeue FAILED rows first, then drain
```

`scripts/drain-outbox.ts` calls `processOutbox` directly, so it needs no running
server and no `CRON_SECRET`. Racing the real cron is safe for the same reason two
overlapping cron invocations are — the worker claims each row with a conditional
update, so they divide the batch. The HTTP route is still the production path:

```bash
curl -H "Authorization: Bearer $(grep ^CRON_SECRET .env | cut -d= -f2- | tr -d '\"')"   http://localhost:3000/api/cron/send-notifications
```

Add `?replay=1` (or `--replay`) to requeue rows that exhausted their retries. That is the manual
half of the outbox promise and is deliberately not automatic: a row reaches
FAILED because five attempts did not work, and retrying it forever on a schedule
hides the problem instead of surfacing it.

The AI assistant needs `GOOGLE_GENERATIVE_AI_API_KEY` (aistudio.google.com/apikey)
and a **signed-in** account. Without the key `assistantAvailable()` is false, the
widget never mounts and `/api/assistant/chat` answers 503 — which is the intended
degradation, not a bug. `AI_ASSISTANT_ENABLED="false"` is the kill switch.

First run: `cp .env.example .env`, fill in `DATABASE_URL`, then `npm run db:migrate && npm run db:seed`.

`SKIP_ENV_VALIDATION=1` is required for `npm run build` when no real secrets are present (CI sets it). Without it, `src/lib/env.ts` fails fast at boot, which is the intended production behaviour.

Two env behaviours worth knowing before you debug them:

- **`npm start` (production mode) requires `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `AUTH_SECRET`** or every server-rendered route 500s. That is deliberate (SEC-18): a production deploy without the shared store has silently unenforced rate limits. Use `npm run dev` for local work until Upstash is configured.
- Empty values in `.env` (`AUTH_SECRET=""`) are treated as unset, not as an empty string, so keys copied from `.env.example` do not fail validation. `next build` is also exempted from the production-secret requirement — a build is not a boot.
- **The assistant has the same shape of guard:** `AI_TIER="free"` is refused in production and, when `AI_ASSISTANT_ENABLED` is true, so is a missing `GOOGLE_GENERATIVE_AI_API_KEY`. Development defaults to `free`, which is why the widget silently disappears rather than erroring on a machine with no key.
- **`IMAGE_STORE=local` is refused in production**, on the same principle as `PAYMENT_PROVIDER=fake`. The local driver writes admin uploads under `public/uploads` (gitignored); a Vercel filesystem is read-only and per-instance, so an upload there would appear to succeed and then 404. Production sets `IMAGE_STORE=blob` with a `BLOB_READ_WRITE_TOKEN`.

## Layout

```
prisma/schema.prisma          all models, including F4–F6 entities (no later migration needed)
prisma/migrations/0_init/     baseline DDL + pg_trgm indexes + order_number_seq
prisma/seed.ts                demo catalogue, guarded against production
prisma.config.ts              Prisma 7 CLI config (schema path, seed command, datasource URL)
src/generated/prisma/         generated client — gitignored, regenerate with `npx prisma generate`
src/lib/{env,db,redis,money,rate-limit,http}.ts
src/lib/auth/                 tokens, password, session rotation, cookies, guards
src/lib/{csrf,safe-redirect,routes,cache-tags}.ts
src/lib/validation/           Zod schemas (auth bodies, catalog query, cart, address, checkout)
src/server/auth/service.ts    register / login / verify / reset flows
src/server/catalog/queries.ts every catalogue read, incl. the sort whitelist
src/server/cart/              owner resolution (user | guestId) + cart service, guest merge
src/server/pricing/           buildQuote + computeTotals (pure), tax-rate setting
src/server/addresses/         owner-scoped address CRUD
src/server/orders/            checkout, capture, webhook pipeline, order number, snapshots
src/server/payments/          PaymentProvider interface + easypaisa / stripe / fake
src/server/notifications/     outbox: queue writer, worker (lease + backoff), templates, Resend driver
src/server/admin/             F4 services: products, categories, orders, reviews, shipping, settings, audit
src/server/uploads/           ImageStore drivers + magic-byte type detection
src/server/assistant/         F5: tools (the security boundary), prompt, agent, sanitize, telemetry
src/server/reviews/           F6: submit/edit/delete + the cookie-free cached public read
src/server/wishlist/          F6: owner-scoped list, add/remove, move-to-cart
src/proxy.ts                  headers, guestId + csrf cookies, Origin check, silent refresh
src/app/                      App Router: (auth), (account), /c/[...slug], /p/[slug], /search, /cart, /checkout
src/app/api/{auth,account}/   auth + account route handlers
src/app/api/{cart,checkout}/  cart mutations, quote, checkout, dev sandbox
src/app/api/{reviews,wishlist}/ F6 customer writes; /api/account/product-state feeds the client widgets
src/app/api/assistant/chat/   the streaming agent route (auth + CSRF + rate limit)
src/app/api/webhooks/         easypaisa / stripe / fake payment callbacks
src/app/api/cron/             expire-orders + send-notifications (Bearer CRON_SECRET; vercel.json)
src/components/               auth, cart, catalog, product, home, seo, site, ui, account, admin, assistant
src/stores/{auth,cart}.ts     display-only client state (never a token, never a price)
tests/integration/            DB-backed capture concurrency + webhook replay
```

## Conventions

- **Validation** — every route handler and server action parses input with a `.strict()` Zod schema via `parseBody`/`parseSearchParams` in `src/lib/http.ts` (SEC-16). Strictness is what stops a client smuggling `role: "ADMIN"` or `price: 1` into a handler.
- **Money** — everything goes through `src/lib/money.ts` (decimal.js, half-up, 2dp). A JS `number` must never hold a monetary value (AD-6). Convert to integer minor units only at the payment-provider boundary.
- **Shared state** — rate limits, idempotency keys and locks live in Redis via `src/lib/redis.ts` (SEC-18). An in-memory `Map` is a silent no-op across Vercel instances; treat one in review as a bug.
- **Ownership** — user-owned rows (`Order`, `Address`, `Cart`, `Session`) are filtered by `userId` in the `where` clause, never after fetching (SEC-23).
- **Errors** — handlers return `{ error: { code, message } }` with generic messages; internal detail goes to logs only (SEC-9, SEC-26).
- **Prisma client** — import from `@/generated/prisma/client`, use the `prisma` singleton in `src/lib/db.ts`. Prisma 7 requires a driver adapter; the Neon adapter is configured there.
- **Catalogue caching** — reads that feed a prerendered page are wrapped in `unstable_cache` with the tags from `src/lib/cache-tags.ts`, which is what makes F4's `revalidateTag` work (SEC-11). An untagged read leaves the revalidate timer as the only lever. Filtered listing and search are deliberately uncached.
- **Admin authorisation is re-checked against the database on every request** (SEC-7). Pages call `requireRole("STAFF","ADMIN")`, route handlers go through `requireAdminRead`/`requireAdminWrite` in `src/server/admin/guard.ts`. The proxy's `/admin` check reads a JWT claim and only saves a render — it is not the control, because a claim is up to 15 minutes stale. Deleting a product and changing the tax rate are ADMIN-only, one rung above STAFF's reversible edits.
- **Admin listings go through `adminListSchema`** (`src/lib/validation/admin/list.ts`): capped page size, `sort` as an opaque token mapped to a hardcoded `orderBy` in the service (SEC-24). Nothing from a query string ever reaches Prisma as an identifier.
- **The admin catalogue schemas are the only place a price enters the system.** SEC-4 says the server owns what a shopper is charged, not that prices appear from nowhere — an operator states one, as a bounded decimal _string_ that reaches Prisma as `Decimal` without passing through a JS number.
- **Uploads are typed by their bytes, never by their name** (`src/server/uploads/image-type.ts`). SVG and GIF are rejected; the stored filename is 16 random bytes plus the sniffed extension. There is no fetch-by-URL import anywhere in F4 — that is the SSRF half of SEC-14.
- **Admin mutations log their actor** via `adminLog` (`src/server/admin/audit.ts`), as structured `[admin]` lines. There is no `AuditLog` model and the schema is fixed through F6, so a durable trail is a deliberate later decision, not an oversight.
- **`revalidateTag` takes two arguments in Next 16.** `revalidateTag(tag)` is deprecated and behaves like `{ expire: 0 }`, making the next shopper's request a blocking cache miss; `src/server/admin/revalidate.ts` passes `"max"` for stale-while-revalidate. `updateTag` is Server-Actions-only and unusable from these route handlers.
- **`export const revalidate` must be a literal.** Next resolves it by static analysis, so `revalidate = CATALOG_REVALIDATE_SECONDS` (or `60 * 5`) fails the build with "Invalid segment configuration export detected" — with no indication of which file. The pages repeat `300`; `src/lib/cache-tags.test.ts` guards the drift.

## Architecture constraints that cross many files

From the ADRs (§4) — the ones a locally-sensible change is most likely to break:

- **Stock lives on `ProductVariant`, not `Product`** (AD-5). Cart items and order items reference **variants**. Price and stock on a product page come from the selected variant (`variant.price ?? product.basePrice`).
- **Payment truth is server-verified only** (AD-8, SEC-6). Stripe = signed webhook. Easypaisa = IPN hash verified with `hashKey` **plus** a transaction-inquiry call. A browser redirect is never proof of payment.
- **The order lifecycle is fixed** (SEC-19): create `PENDING` → validate stock _without_ decrementing → payment → decrement atomically _inside_ the verified-PAID transaction while re-checking availability → auto-refund + notify if stock vanished. Decrementing earlier strands inventory; decrementing later oversells. The conditional `updateMany({ where: { stock: { gte: qty } } })` with an affected-count assertion is what makes oversell impossible.
- **Server recomputes all totals from the DB at checkout** (SEC-4, SEC-11); client amounts are ignored.
- **Orders snapshot address and items** — later catalog or address edits must not mutate historical orders.
- **`Notification` is an outbox**, not a send call: rows are QUEUED and a worker flips them SENT/FAILED with retries. Capture writes its confirmation row **inside** the capture transaction, so a crash cannot commit an order and lose its email.
- **A cart line stores no price.** Unit prices are resolved from the variant on every read and again at checkout; a price frozen onto a cart row is a price a shopper can sit on until it is wrong (SEC-11).
- **`Idempotency-Key` is a header, not a body field** — it identifies the checkout _attempt_. The client regenerates it when the address or shipping rate changes, because that is a different order; reusing it would replay the previous one.
- **Webhooks are exempt from CSRF in the proxy** (`/api/webhooks/`) and authenticate by signature or keyed hash instead. Read the body with `request.text()`, once: Stripe signs the exact bytes.
- **`env.ts` refuses to boot** with `PAYMENT_PROVIDER=fake` in production, or without the selected provider's credentials.
- **`ratingAvg`/`ratingCount` are cached on `Product`** and must be recomputed transactionally on review moderation.

## AI assistant boundaries (F5)

Customer-scoped tool user, not an operator. Retrieved catalog and review text is **data, not instructions** — and the enforcement lives in the tools, not the prompt. Every rule below is structural: it holds whatever the model is talked into saying.

- **`src/server/assistant/tools.ts` is the whole security boundary.** Five tools, four read-only, one write. No tool schema has a price, a discount, a user id, an order id or a role field, so those are not requests the model is *able* to make (SEC-2, SEC-3, SEC-4). `tools.test.ts` enumerates the surface — adding a tool fails it on purpose.
- **Identity comes from a closure, not an argument.** `buildAssistantTools(userId)` is built per request from the session the route read; `addToCart` closes over it. Nothing travelling alongside the model's arguments can name a user.
- **`addToCart` is the only write, and it cannot pay.** There is no checkout, order, refund or stock tool to reach. "Refuses to check out" is a missing capability, not a promise in the prompt.
- **Nothing returns a Prisma row.** Every result is a hand-built object with named, sanitized fields — no `isActive`, no `source` (which would out the seed data), no ids beyond `variantId`, which the product page already exposes. Failures return `{ ok: false, message }`; throwing would put a stack trace in the model's context (SEC-26).
- **Read tools force `inStock: 1` and go through `catalogQuerySchema`**, so the page cap and sort whitelist apply to the model exactly as to a shopper editing a URL (SEC-24). The model has no sort input at all.
- **Untrusted text is neutralized then fenced** by `sanitize.ts`: Unicode `Cc`/`Cf`/`Zl`/`Zp` stripped (the zero-width and bidi tricks), chat-template and fence lookalikes removed, length capped, then wrapped in `<untrusted>…</untrusted>`. The fence is a hint to the model; the tools are the control.
- **The renderer has its own allowlist.** `components/assistant/link-policy.ts` only makes `[label](/p|/c|/search|/cart…)` clickable. A model argued into emitting `[Pay now](https://evil.example)` renders that as characters.
- **The client may post text parts only.** `assistantChatSchema` is `.strict()` and has no tool-part shape, so a browser cannot replay a forged tool result into the next turn. The cost is real and deliberate: the model does not carry a tool result across turns and re-searches instead.
- **Requires a signed-in user**, unlike the human cart path which serves guests — see the route handler's comment for why (a `Set-Cookie` on a stream, and an anonymous rate-limit bucket being no bucket at all).
- **Two rate-limit buckets per request**, `user:<id>` and `ip:<addr>`, both on the `ai:chat` budget in Redis (SEC-8, SEC-18).
- **`AI_TIER="free"` is refused in production** (SEC-13), on the same principle as `PAYMENT_PROVIDER=fake` and `IMAGE_STORE=local`: the free Gemini tier may train on prompts, and a prompt is the most PII-dense thing in an ecommerce app.
- **Telemetry carries no message text** — one `[ai] turn` line per turn with steps, tool names, tokens, latency and outcome, under a non-reversible actor tag (SEC-25).

## F6 boundaries (reviews, wishlist, notifications)

- **A prerendered route may not read a cookie.** `cookies()` anywhere in `/p/[slug]` — including inside a `<Suspense>` boundary — turns the whole route dynamic and gives back F2's LCP. So the reviews block is an anonymous `unstable_cache` read tagged `cacheTags.product(slug)`, and everything about the caller (their own review, whether they saved the product) is fetched after hydration from `/api/account/product-state`. `components/product/product-personal.tsx` is that split. Check the build's route table for `● /p/[slug]` after touching that page; a `ƒ` there is the regression.
- **`verifiedPurchase` is derived, never accepted.** From the caller's own orders with `paymentStatus: PAID` **and** `status ∈ {PROCESSING, SHIPPED, DELIVERED}` — a REFUNDED or CANCELLED order fails on status though it once had `paidAt`. It is recomputed on edit, not copied forward.
- **An edited review returns to PENDING.** Otherwise approving a review is approving whatever text replaces it later.
- **`recomputeProductRating` has exactly one implementation** (`src/server/admin/reviews.ts`) and is always called inside the transaction that changed what is APPROVED. It recomputes from a fresh aggregate rather than nudging the old value by a delta — an incremental update is correct only if every prior one was.
- **The outbox worker claims with a lease, not a status.** `NotificationStatus` has no SENDING state and the schema is fixed, so the claim is a conditional `updateMany` that re-asserts QUEUED and pushes `nextAttemptAt` past the send timeout. Two overlapping cron runs divide the batch; a crashed worker's row becomes due again. `attempts` increments at *claim* time so a poison row cannot occupy the worker forever.
- **A permanent rejection is not retried.** The `EmailSender` outcome carries `retryable`: 429 and 5xx go back in the queue, other 4xx go straight to FAILED. Retrying a 422 for a malformed address five times only delays the moment somebody notices.
- **Templates escape everything they interpolate and only emit same-origin links.** A display name is user-chosen text and a webmail client is a browser (`render.ts`).
- **The wishlist is signed-in only** and has no guest path, unlike the cart. Move-to-cart re-resolves the variant with `productId` in the same `where`, so a variant id from another product matches nothing.

## Decisions locked

|               |                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------ |
| Base currency | **PKR**, single currency, no FX. `Order.currency`/`fxRate` exist for later.                |
| Tax           | Single flat rate from `TAX_RATE`; a `Setting` row keyed `tax.rate` overrides at runtime.   |
| Payments      | **Easypaisa first**, Stripe second, both behind one `PaymentProvider` interface.           |
| Dev payments  | `PAYMENT_PROVIDER=fake` — HMAC-signed sandbox provider; `env.ts` refuses it in production. |

Open: Easypaisa sandbox credentials — the provider is written against the published Hosted Checkout scheme (AES-128-ECB request hash, v4 inquiry endpoint) but has never been run against a sandbox; every field name Easypaisa controls sits in the two constant blocks at the top of `src/server/payments/easypaisa.ts`. Easypaisa also has no merchant refund API, so `refund()` reports `automatic: false` and the capture path queues an operator notification instead. Stripe is written and gated but unavailable to Pakistan-incorporated merchants (PKR is not a presentment currency on most accounts), so it needs a decision before it is selected.

## Seed data is a launch gate

Demo products carry `source = "pexels"`. Purge them before go-live (SEC-27): `deleteMany({ where: { source: "pexels" } })`. The seed script throws if `NODE_ENV=production`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
