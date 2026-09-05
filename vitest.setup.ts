/**
 * Unit-test environment.
 *
 * `src/lib/env.ts` fails fast when required variables are missing, which is the
 * point of it — so the suite supplies a fixed, obviously fake set rather than
 * reading the developer's real .env. Nothing in the unit suite talks to
 * Postgres or Redis; anything that would is integration-tested instead.
 */
// `NODE_ENV` is typed read-only by @types/node; the assignment is real and
// intentional here, so the cast is on the env object rather than a suppression
// of the whole file.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET ??= "test-secret-value-that-is-long-enough-32b";
process.env.APP_URL ??= "http://localhost:3000";
process.env.BASE_CURRENCY ??= "PKR";
process.env.TAX_RATE ??= "0";
