# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A production-grade global clothing store with an agentic AI shopping assistant. `spec.md` is the authoritative design document: §1–§7 (overview, stack, ADRs, data model, security requirements SEC-1…SEC-29, NFRs) are shared context for every session; §8 lists features F0→F6 built **one at a time, in order**. Read §1–§7 plus the single feature section you are working on.

**F0 (foundation) is complete.** F1 (auth) is next. Build order: `F0 → F1/F2 → F3/F4 → F5 → F6`. Each feature section carries its own _Depends on_, _Entities_, _Security focus_ (SEC ids) and a **DoD** — treat the DoD as the acceptance test.

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
npm test                 # vitest run
npm run test:watch
npx vitest run src/lib/money.test.ts -t "rounds half away from zero"   # single test

npm run db:migrate       # prisma migrate dev   (local schema change)
npm run db:deploy        # prisma migrate deploy (release path — never `db push` in prod, SEC-28)
npm run db:seed          # ~53 demo products; refuses to run when NODE_ENV=production (SEC-27)
npm run db:studio
npm run check:public-env # SEC-12 gate: no secret may carry a NEXT_PUBLIC_ prefix
```

First run: `cp .env.example .env`, fill in `DATABASE_URL`, then `npm run db:migrate && npm run db:seed`.

`SKIP_ENV_VALIDATION=1` is required for `npm run build` when no real secrets are present (CI sets it). Without it, `src/lib/env.ts` fails fast at boot, which is the intended production behaviour.

Two env behaviours worth knowing before you debug them:

- **`npm start` (production mode) requires `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `AUTH_SECRET`** or every server-rendered route 500s. That is deliberate (SEC-18): a production deploy without the shared store has silently unenforced rate limits. Use `npm run dev` for local work until Upstash is configured.
- Empty values in `.env` (`AUTH_SECRET=""`) are treated as unset, not as an empty string, so keys copied from `.env.example` do not fail validation. `next build` is also exempted from the production-secret requirement — a build is not a boot.

## Layout

```
prisma/schema.prisma          all models, including F4–F6 entities (no later migration needed)
prisma/migrations/0_init/     baseline DDL + pg_trgm indexes + order_number_seq
prisma/seed.ts                demo catalogue, guarded against production
prisma.config.ts              Prisma 7 CLI config (schema path, seed command, datasource URL)
src/generated/prisma/         generated client — gitignored, regenerate with `npx prisma generate`
src/lib/{env,db,redis,money,rate-limit,http}.ts
src/proxy.ts                  security headers + guestId cookie
src/app/                      App Router: layout, error boundaries, /api/health
```

## Conventions

- **Validation** — every route handler and server action parses input with a `.strict()` Zod schema via `parseBody`/`parseSearchParams` in `src/lib/http.ts` (SEC-16). Strictness is what stops a client smuggling `role: "ADMIN"` or `price: 1` into a handler.
- **Money** — everything goes through `src/lib/money.ts` (decimal.js, half-up, 2dp). A JS `number` must never hold a monetary value (AD-6). Convert to integer minor units only at the payment-provider boundary.
- **Shared state** — rate limits, idempotency keys and locks live in Redis via `src/lib/redis.ts` (SEC-18). An in-memory `Map` is a silent no-op across Vercel instances; treat one in review as a bug.
- **Ownership** — user-owned rows (`Order`, `Address`, `Cart`, `Session`) are filtered by `userId` in the `where` clause, never after fetching (SEC-23).
- **Errors** — handlers return `{ error: { code, message } }` with generic messages; internal detail goes to logs only (SEC-9, SEC-26).
- **Prisma client** — import from `@/generated/prisma/client`, use the `prisma` singleton in `src/lib/db.ts`. Prisma 7 requires a driver adapter; the Neon adapter is configured there.

## Architecture constraints that cross many files

From the ADRs (§4) — the ones a locally-sensible change is most likely to break:

- **Stock lives on `ProductVariant`, not `Product`** (AD-5). Cart items and order items reference **variants**. Price and stock on a product page come from the selected variant (`variant.price ?? product.basePrice`).
- **Payment truth is server-verified only** (AD-8, SEC-6). Stripe = signed webhook. Easypaisa = IPN hash verified with `hashKey` **plus** a transaction-inquiry call. A browser redirect is never proof of payment.
- **The order lifecycle is fixed** (SEC-19): create `PENDING` → validate stock _without_ decrementing → payment → decrement atomically _inside_ the verified-PAID transaction while re-checking availability → auto-refund + notify if stock vanished. Decrementing earlier strands inventory; decrementing later oversells. The conditional `updateMany({ where: { stock: { gte: qty } } })` with an affected-count assertion is what makes oversell impossible.
- **Server recomputes all totals from the DB at checkout** (SEC-4, SEC-11); client amounts are ignored.
- **Orders snapshot address and items** — later catalog or address edits must not mutate historical orders.
- **`Notification` is an outbox**, not a send call: rows are QUEUED and a worker flips them SENT/FAILED with retries.
- **`ratingAvg`/`ratingCount` are cached on `Product`** and must be recomputed transactionally on review moderation.

## AI assistant boundaries (F5)

Customer-scoped tool user, not an operator. Read tools query the real catalog and the model may only surface tool-returned products. The only write tool is `addToCart`, deriving the user **from the session** (SEC-3) at the server-computed price (SEC-4). It may fill a cart but never initiates payment or checkout (SEC-2). No admin tools; results sanitized (SEC-26). Retrieved catalog and review text is **data, not instructions** — enforcement lives in the tools, not the prompt.

## Decisions locked

|               |                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------- |
| Base currency | **PKR**, single currency, no FX. `Order.currency`/`fxRate` exist for later.              |
| Tax           | Single flat rate from `TAX_RATE`; a `Setting` row keyed `tax.rate` overrides at runtime. |
| Payments      | **Easypaisa first**, Stripe second, both behind one `PaymentProvider` interface.         |

Open: Easypaisa sandbox credentials; Stripe is unavailable to Pakistan-incorporated merchants and PKR is not a presentment currency on most Stripe accounts, so the Stripe leg needs a decision before it is wired.

## Seed data is a launch gate

Demo products carry `source = "pexels"`. Purge them before go-live (SEC-27): `deleteMany({ where: { source: "pexels" } })`. The seed script throws if `NODE_ENV=production`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
