# AI-Powered Global Clothing Store — Project Spec

**Version:** 2.0 · **Status:** Draft for implementation (spec-driven, ship F0→F6 feature-by-feature) · **Owner:** Ahsan Ali

> One file, organized feature-wise. For Claude Code CLI sessions: keep §1–§7 as shared context, then work one feature section (§8: F0…F6) at a time.

---

## 1. Overview & Goals
Production-grade, SEO-friendly, secure ecommerce store for a global clothing brand (men's & women's apparel), with an **agentic AI shopping assistant** that guides shoppers by interest and can act on the cart (with human confirmation on money).

**Success criteria**
- Browse, filter, buy men's/women's clothing with size + color variants, worldwide.
- The AI assistant recommends only real catalog products and can add items to the cart; it never charges or checks out without explicit user confirmation.
- Indexable (rich results), fast (good Core Web Vitals), hardened against the standard ecommerce attack surface.
- Client manages catalog, inventory, orders, reviews from an admin dashboard.

---

## 2. Scope
**In (MVP, F0–F6):** auth & accounts; catalog with size/color variants, search/filter/sort; server cart + guest merge; addresses, global shipping, tax field, checkout; payments (Stripe international + **Easypaisa** Pakistan) behind a provider interface; admin dashboard; AI assistant (Gemini) with read + cart-write tools + HITL; reviews + wishlist; transactional emails; SEO, performance, security, basic analytics/monitoring.

**Out (explicit):** coupons/promo engine (schema keeps `discountTotal`; v1.1); i18n UI copy (currency multi, copy English); marketplace/multi-vendor, POS, subscriptions, loyalty; returns/RMA workflow (status supports `REFUNDED`, full RMA v1.1); native apps.

---

## 3. Tech Stack
| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript (strict) |
| Backend | Next.js Route Handlers + Server Actions |
| DB | PostgreSQL on Neon |
| ORM | Prisma (v7, Postgres) |
| Client state | Zustand (cart/UI/auth-status only — never the JWT) |
| Auth | JWT in httpOnly cookies + rotating refresh tokens |
| AI | Gemini via Vercel AI SDK (`@ai-sdk/google`), `gemini-2.5-flash` |
| Payments | Stripe (international) + **Easypaisa** (Pakistan) behind a `PaymentProvider` interface |
| Shared state store | Upstash Redis / Vercel KV — rate limits, idempotency keys, locks (SEC-18) |
| Email | Resend via a persisted outbox |
| Images (dev seed) | Pexels API |
| Image upload (admin) | Cloudinary / Vercel Blob / UploadThing |
| Deploy | Vercel (serverless) |
| Validation | Zod on every API boundary |

---

## 4. Architecture Decisions (ADR)
- **AD-1 — Custom Next.js backend, not Medusa.** Honors "backend also in Next.js"; full control of the agentic layer.
- **AD-2 — PostgreSQL, not MongoDB.** Transactional integrity for money/inventory; Prisma v7 supports Postgres (dropped Mongo). Flexible attributes via a `Json` column.
- **AD-3 — JWT in httpOnly cookies.** Zustand holds only non-sensitive UI auth state.
- **AD-4 — Gemini provider swappable.** Dev on free tier; one config change → paid tier / Vertex AI for production (SEC-13).
- **AD-5 — Stock lives on the variant** (per size+color).
- **AD-6 — Money is `Decimal`, never float.**
- **AD-7 — Serverless-aware.** No in-memory counters/locks; shared state in Redis/KV (SEC-18); DB-level atomicity for inventory (SEC-19).
- **AD-8 — Payment confirmation server-verified.** Stripe: signed webhook. Easypaisa: hosted checkout + IPN/callback hash verified with merchant `hashKey`, **and** a server-side transaction-inquiry call before marking PAID (SEC-6).

---

## 5. Data Model (summary)
Authoritative: `prisma/schema.prisma` (delivered separately).
- **User** (role CUSTOMER/STAFF/ADMIN, emailVerified) · **Session** (hashed rotating refresh token) · **VerificationToken** (hashed, typed, single-use, expiring)
- **Category** (two-level tree) · **Product** (basePrice, cached ratingAvg/Count, images[], Json attributes, source+externalId seed marker) · **ProductVariant** (size + colorName + colorHex, sku, per-variant stock, optional price). **Cart/Order reference variants, not products.**
- **Cart/CartItem** (user or guestId) · **Order/OrderItem** (orderNumber, status, paymentStatus, currency+totals, **address + item snapshots**)
- **Address** · **ShippingZone/ShippingRate** (`["*"]` catch-all) · **Review** (verifiedPurchase, moderation, unique per product+user) · **WishlistItem** · **Notification** (email outbox)

---

## 6. Global Security Requirements
**v1 (baseline)**
- **SEC-1 CSRF:** SameSite cookies **plus** anti-CSRF token / strict Origin check on every mutation.
- **SEC-2 Agent safety:** retrieved catalog text is data, never commands; write tools enforce rules server-side; model can't set price/discount; HITL on all money actions.
- **SEC-3 Tool identity:** agent tools derive the user from the session, never from model input.
- **SEC-4 Price integrity:** server is the only source of truth for prices/totals; client amounts ignored; checkout recomputes from DB.
- **SEC-5 Inventory atomicity:** transactional, conditional stock decrement; no oversell.
- **SEC-6 Payment trust:** PAID set only by server-verified signal — Stripe signed webhook; Easypaisa IPN hash-verified with `hashKey` **and** transaction-inquiry confirmation. Never the client redirect.
- **SEC-7 AuthZ everywhere:** server-side RBAC on every protected route; UI hiding isn't a control; sensitive admin actions re-check role vs DB.
- **SEC-8 Rate limiting:** login, register, reset, review submit, AI endpoint (store via SEC-18).
- **SEC-9 No enumeration:** login/reset responses don't reveal whether an email exists.
- **SEC-10 Token hygiene:** refresh/verification/reset tokens hashed, single-use where applicable, expiring; reset revokes sessions.
- **SEC-11 Freshness:** checkout re-validates price/stock; cached pages can't cause an incorrect charge.
- **SEC-12 Secrets:** all keys server-only env; never `NEXT_PUBLIC_`.
- **SEC-13 AI data privacy:** Gemini free tier may train on prompts → dev/demo only; production uses paid tier or Vertex AI. Provider swappable (AD-4).
- **SEC-14 Upload/SSRF:** validate uploaded image type/size; no server-side fetch of arbitrary user URLs.
- **SEC-15 Headers:** CSP, HSTS, X-Content-Type-Options, restrictive referrer policy.
- **SEC-16 Input validation:** Zod on every input; reject unknown fields.
- **SEC-17 Compliance:** cookie consent (decline non-essential by default), privacy policy + terms (global/GDPR).

**v2 (second critic pass — see §10)**
- **SEC-18 Serverless-safe state:** rate limits, idempotency keys, locks live in **Redis/KV**, not process memory (Vercel functions are multi-instance/stateless).
- **SEC-19 Order/payment/inventory lifecycle:** create order `PENDING` → validate stock (no decrement) → payment → **decrement only inside the verified-PAID transaction, re-checking availability**; if stock gone at capture, auto-refund + notify. Expire abandoned `PENDING` orders.
- **SEC-20 Idempotent checkout:** idempotency key per attempt prevents duplicate orders/charges on double-click/retry.
- **SEC-21 Refresh-token reuse detection:** a rotated token presented twice ⇒ revoke the whole session family.
- **SEC-22 Short access-token TTL:** stateless JWT can't be revoked on logout, so access tokens are short (~10–15 min); revocation lives with refresh tokens.
- **SEC-23 IDOR / ownership:** every resource read/write scoped to its owner; unguessable IDs are not access control.
- **SEC-24 Query safety:** whitelist sortable fields, cap page size, bound filters (Prisma already blocks SQLi).
- **SEC-25 LLM data minimization:** send the model only product context + a cart summary; never card data, full addresses, secrets, or raw PII.
- **SEC-26 Tool authorization scope:** agent has only customer-scoped read tools + `addToCart`; no admin tools; tool results sanitized (no raw DB rows/errors).
- **SEC-27 Seed data is a launch gate:** purge `source="pexels"` products + stock imagery before production; seed script refuses to run when `NODE_ENV=production`.
- **SEC-28 DB ops:** `prisma migrate deploy` in prod (never `db push`); reviewed migrations; Neon backups.
- **SEC-29 orderNumber generation:** DB sequence / random suffix so concurrent orders never collide.

---

## 7. SEO & Non-Functional (cross-cutting)
- **SEO:** SSR/ISR for indexable pages; `noindex` account/checkout; Metadata API; JSON-LD `Product`/`BreadcrumbList`/`AggregateRating`; `sitemap.ts` + `robots.ts`; `next/image` everywhere. (Details in F2.)
- **Performance:** good CWV; animations must not regress LCP/CLS and respect `prefers-reduced-motion`.
- **Accessibility:** keyboard nav, contrast, alt text.
- **Reliability:** email outbox with retries; idempotent webhooks.
- **Observability:** Sentry (errors), Langfuse (AI, PII-scrubbed), basic analytics.
- **Testing:** unit for money/inventory/auth; e2e for checkout & auth (happy + edge).
- **CI/CD:** typecheck + lint + test + build gate on PR; preview deploys; `migrate deploy` on release.

---

## 8. Feature Specs (F0 → F6)

Build order: **F0 → F1/F2 → F3/F4 → F5 → F6.**

### F0 — Foundation
*Depends on:* — · *Security focus:* SEC-12, SEC-16, SEC-27, SEC-28.
The skeleton everything builds on.
- [ ] Next.js App Router + TS **strict**; ESLint + Prettier.
- [ ] Prisma wired to Neon; `schema.prisma` in place; `prisma migrate dev` clean.
- [ ] `prisma/seed.ts` runs (~52 products + size/color variants + shipping zones); **seed refuses to run when `NODE_ENV=production` (SEC-27)**.
- [ ] Env convention (`.env.example`); no secret uses `NEXT_PUBLIC_` (SEC-12).
- [ ] Shared Redis/KV client initialized (SEC-18).
- [ ] Zod set as the validation convention (SEC-16).
- [ ] Base shell: root layout, error boundary, `not-found`, `/api/health`.
- [ ] Security-headers middleware stub (SEC-15).
- [ ] CI: typecheck + lint + build on PR; document `migrate deploy` for release (SEC-28).
- **DoD:** fresh clone + env → migrate + seed succeed, homepage lists seeded products, CI green, seed errors on prod env.

### F1 — Auth & Accounts
*Depends on:* F0 · *Entities:* User, Session, VerificationToken · *Security focus:* SEC-1, 7, 8, 9, 10, 18, 21, 22, 23.
- [ ] Register / login / logout; passwords hashed (argon2/bcrypt).
- [ ] Short-lived access JWT (~10–15 min, SEC-22) + rotating refresh token; both httpOnly, Secure, SameSite cookies.
- [ ] Refresh rotation with **reuse detection** → revoke session family (SEC-21).
- [ ] Email verification + password reset via hashed, single-use, expiring tokens (SEC-10); reset **revokes all sessions**.
- [ ] RBAC middleware guard **and** server-side role check on every protected action; sensitive admin actions re-check vs DB (SEC-7).
- [ ] CSRF protection on cookie-authenticated mutations (SEC-1).
- [ ] Rate-limit login/register/reset via Redis/KV (SEC-8, 18); generic responses — no enumeration (SEC-9).
- [ ] Verification gate: browse yes; checkout/reviews require verified email.
- [ ] All account/resource reads owner-scoped (SEC-23).
- **DoD:** full register→verify→login→reset works; rotating a refresh token twice triggers family revocation; a non-admin with spoofed client `role` is rejected; auth endpoints throttle under burst.

### F2 — Catalog & SEO
*Depends on:* F0 · *Entities:* Category, Product, ProductVariant, Review (read) · *Security focus:* SEC-11, 14, 15, 24.
- [ ] Category (two-level) nav + product listing, paginated (**page size capped**, SEC-24).
- [ ] Product detail with **variant selector (size + color)**; out-of-stock variants disabled; price/stock come from the selected variant.
- [ ] Search (keyword) via Postgres `pg_trgm` GIN index on `title` (raw migration).
- [ ] Filters (category, price, size, color, brand, in-stock) + sort (price, rating, newest) — sort field **whitelisted** (SEC-24).
- [ ] Product/category pages SSR/ISR; on-demand revalidation when catalog is edited (SEC-11).
- [ ] Metadata API per page; canonical URLs; JSON-LD `Product`/`BreadcrumbList`/`AggregateRating`; `sitemap.ts` + `robots.ts`.
- [ ] All imagery via `next/image` with a **strict** remote-host whitelist (no wildcard, SEC-14).
- [ ] **Homepage carousel/slider** — an auto-rotating hero + featured/new-arrivals carousel on the home page. Must: **pause on hover/focus**, be keyboard- and swipe-navigable, expose proper ARIA roles/labels, respect `prefers-reduced-motion` (no autoplay when reduced), and keep the **first slide as the prioritized LCP image** with later slides lazy-loaded — so it never regresses Core Web Vitals or SEO.
- **DoD:** product page renders server-side with correct variant price/stock, passes a Rich Results test, filters/sort/search return correct, bounded sets; the homepage carousel auto-rotates, pauses on hover/focus, is keyboard-navigable, respects reduced-motion, and does not regress LCP.

### F3 — Cart & Checkout (Stripe + Easypaisa)
*Depends on:* F0, F1, F2 · *Entities:* Cart, CartItem, Order, OrderItem, Address, ShippingZone, ShippingRate, ProductVariant · *Security focus:* SEC-4, 5, 6, 18, 19, 20, 23, 29.
> **Built.** Currency (PKR, no FX), tax rule (flat, `TAX_RATE` with a `tax.rate` `Setting` override) and integration mode (Hosted Checkout redirect) are decided in CLAUDE.md. Easypaisa credentials are still outstanding: the provider is written against the published scheme but unexercised, and `PAYMENT_PROVIDER=fake` — an HMAC-signed local provider driving the same verify → inquire → capture path — carries development until they arrive.

*Cart & address*
- [x] Server cart keyed to `userId` (member) or `guestId` cookie (guest).
- [x] **Guest → user merge on login**: dedupe by variant, delete guest cart (SEC-23).
- [x] Cart items reference a variant; inactive/unavailable variants flagged and blocked at checkout.
- [x] Address CRUD + default; owner-scoped (SEC-23).

*Shipping & totals*
- [x] Resolve `ShippingZone` by destination country (`["*"]` fallback); pick `ShippingRate`; apply `freeOver`.
- [x] Tax per configured rule (MVP: single configurable rate).
- [x] **Checkout recomputes all prices/shipping/tax/totals server-side from DB** — client amounts ignored (SEC-4); convert via agreed FX source, store rate on order.

*Order & payment lifecycle (SEC-19 — follow exactly)*
- [x] Create `Order = PENDING` with **address + item snapshots**; `orderNumber` from a DB sequence / random suffix (SEC-29).
- [x] Validate stock now, **do not decrement**.
- [x] Initiate payment via `PaymentProvider`: Stripe (PaymentIntent/Checkout Session) · Easypaisa (**Hosted Checkout redirect**, methods MA/OTC, `storeId`/`hashKey`).
- [x] **Idempotency key** per checkout (Redis/KV) — no duplicate orders/charges (SEC-20, 18).
- [x] Confirm PAID only via server-verified signal (SEC-6/AD-8): Stripe signed webhook; Easypaisa **IPN hash verified with `hashKey`** *and* **transaction-inquiry**. Never the browser redirect.
- [x] On verified PAID, in **one transaction**: re-check + **atomically decrement** stock (`stock >= qty`); set PAID/PROCESSING. If stock gone → **auto-refund + notify** (SEC-19).
- [x] Expire abandoned `PENDING` orders; queue confirmation email (sent in F6).
- **DoD:** two concurrent checkouts for the last unit → exactly one PAID + one clean rejection; spoofed price can't change the charge; forged success redirect can't mark PAID; double-click creates one order.

### F4 — Admin Dashboard
*Depends on:* F0, F1, F2 · *Entities:* Product, ProductVariant, Category, Order, Review, ShippingZone/Rate · *Security focus:* SEC-7, 14, 16, 24.
> **Built.** Image upload is an `ImageStore` interface with a `local` driver (development; refused in production by `env.ts`) and a Vercel Blob driver, chosen by `IMAGE_STORE`. Status transitions are logged as structured `[admin]` lines rather than to a table: the schema is fixed through F6 and has no `AuditLog`, so a durable trail is a deliberate later decision. Settings gained a runtime tax-rate override (ADMIN only), which is what `Setting.tax.rate` was reserved for.
- [x] RBAC-gated (STAFF/ADMIN); **every endpoint re-checks role vs DB** (SEC-7).
- [x] Product + variant CRUD (size/color/SKU/price/stock).
- [x] Image upload with type/size validation; no arbitrary-URL fetch (SEC-14).
- [x] Inventory view/edit + low-stock indicator.
- [x] Orders list/detail; guarded, logged status transitions.
- [x] Review moderation (approve/reject) → triggers `ratingAvg`/`ratingCount` recompute (see F6).
- [x] Shipping zone/rate management.
- [x] Admin lists paginate with capped size + whitelisted sort (SEC-24); Zod-validated (SEC-16).
- **DoD:** admin creates a product with variants that is immediately purchasable at the right price; a demoted admin loses access immediately; uploads reject non-image/oversized files.

### F5 — AI Shopping Assistant (Gemini)
*Depends on:* F0, F1, F2, F3 · *Entities:* Product, ProductVariant, Cart (via tools) · *Security focus:* SEC-2, 3, 4, 8, 12, 13, 18, 25, 26.
- [ ] Gemini via Vercel AI SDK, **server-side only** — key never reaches the browser (SEC-12); behind an authenticated Route Handler.
- [ ] Read tools: `searchProducts`, `recommendByInterest`, `getProductDetails`, `filterByBudget` — query the real catalog; model surfaces **only** tool-returned products (no invented SKUs).
- [ ] Write tool: `addToCart` — user from the **session** (SEC-3), valid variant at **server-computed price** (SEC-4).
- [ ] **HITL**: may fill the cart, **never** initiates payment/checkout (SEC-2).
- [ ] Prompt-injection defense: retrieved text is data; tools enforce rules regardless of model output; model can't set price/discount (SEC-2).
- [ ] Tool scope: customer-scoped only, no admin tools; results sanitized — no raw DB rows/PII/errors (SEC-26).
- [ ] Data minimization: product context + cart summary only; never card/PII/secrets (SEC-25).
- [ ] Guardrails: off-topic/abuse handling; **cap tool-call iterations per turn**.
- [ ] Cost/abuse: require a session; rate-limit per user/IP via Redis/KV (SEC-8, 18); retry/backoff on 429; graceful fallback. Prod on paid tier/Vertex (SEC-13).
- [ ] Observability (Langfuse) with PII scrubbing.
- **DoD:** recommends only real in-stock products; adds a selected variant to the caller's own cart; refuses to checkout/pay; an instruction hidden in a product review doesn't change its behavior, pricing, or scope.

### F6 — Reviews, Wishlist, Notifications & Polish
*Depends on:* F0–F4 · *Entities:* Review, WishlistItem, Notification, Product (ratingAvg) · *Security focus:* SEC-8, 15, 16, 18, 23, 27.
*Reviews*
- [ ] Submit (auth + verified email); **`verifiedPurchase` computed server-side** from paid/delivered orders — never client-claimed; refunded/cancelled don't grant it.
- [ ] One review per (product, user); moderation `status` (PENDING → APPROVED before shown).
- [ ] Approve/edit/delete → **recompute `ratingAvg`/`ratingCount` transactionally** (no drift).
- [ ] Rate-limit submission (SEC-8, 18).

*Wishlist*
- [ ] Add/remove; move-to-cart; unique per (user, product); owner-scoped (SEC-23).

*Notifications (email outbox)*
- [ ] Worker sends QUEUED rows via Resend, flips SENT/FAILED, **retries** on FAILED.
- [ ] Covers welcome, verification, reset, order confirmation, shipped/delivered.
- [ ] A provider blip must not lose an email (outbox replay).

*Polish (NFR)*
- [ ] Homepage animations (Framer Motion) respecting `prefers-reduced-motion`, no LCP/CLS regression.
- [ ] Security headers finalized (SEC-15); Sentry + analytics; accessibility pass; final security review vs §6.
- [ ] **Launch gate:** purge seed/demo data (`source="pexels"`) + stock imagery before go-live (SEC-27).
- **DoD:** reviews verified + moderated with accurate cached ratings; wishlist owner-scoped; no email lost across a provider blip; Lighthouse passes perf/SEO/a11y; demo data gone before launch.

---

## 9. Open Decisions (needed before F3; some block it)
- **Easypaisa merchant credentials** — client provides `storeId`, `username`, `password`, `hashKey` (+ sandbox). **Blocks F3 payments.**
- **Easypaisa integration mode** — recommend **Hosted Checkout (redirect)** for MVP over direct REST. Confirm.
- **Base currency + FX source** — base currency + where rates come from (static table or FX API). **Blocks F3 totals.**
- **Tax rule** — single flat configurable rate (MVP) vs per-country.
- **Email provider** — Resend (assumed) vs SendGrid.

---

## 10. Adversarial Critic Pass v2 — New Loopholes Caught & Fixed
v1 pass (20 items) is folded into SEC-1…17. This second pass targets what v1 missed:

| # | New loophole | Fix |
|---|---|---|
| 21 | In-memory rate limit/lock **breaks on Vercel** (multi-instance) — limits silently don't apply | SEC-18: Redis/KV-backed |
| 22 | **When** to decrement stock vs payment — at PENDING strands stock; never = oversell | SEC-19: decrement inside verified-PAID txn, re-check, auto-refund if gone |
| 23 | Double-click "Place order" → **duplicate charge/order** | SEC-20: idempotency key per checkout |
| 24 | **Stolen refresh token** reused with the real one | SEC-21: reuse detection revokes session family |
| 25 | Logout can't kill a **stateless JWT** still valid for its TTL | SEC-22: short access-token TTL |
| 26 | **IDOR** — fetch another user's order/address by id | SEC-23: ownership-scoped queries |
| 27 | User-controlled **sort column / unbounded pages** → DoS/scraping | SEC-24: whitelist + page cap |
| 28 | Full **PII/card sent to the LLM** unnecessarily | SEC-25: data minimization |
| 29 | Agent tool result leaks **raw DB rows / stack traces** or reaches admin capability | SEC-26: scoped tools + sanitized outputs |
| 30 | **Demo/stock products** ship to production as real items | SEC-27: purge gate + prod-guarded seed |
| 31 | `db push` in prod or unreviewed migration → **data loss** | SEC-28: `migrate deploy` + backups |
| 32 | Concurrent **orderNumber collision** | SEC-29: DB sequence / random suffix |
| 33 | Easypaisa **client redirect trusted** as proof of payment | SEC-6/AD-8: IPN hash verify + inquiry API |

---

## 11. Deliverables
- `prisma/schema.prisma`, `prisma/seed.ts` (delivered).
- This `spec.md`.
- Next on request: a `CLAUDE.md` session-init file.
