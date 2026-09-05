#!/usr/bin/env node
/**
 * CI gate for SEC-12: nothing secret may carry a NEXT_PUBLIC_ prefix, because
 * Next inlines those into the client bundle.
 *
 * Scans .env.example and the source tree for NEXT_PUBLIC_ names that look like
 * credentials. Exits non-zero on a hit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const FORBIDDEN =
  /^NEXT_PUBLIC_.*(SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|HASHKEY|HASH_KEY|API_KEY|APIKEY|DATABASE|CONNECTION)/i;
const SCAN_DIRS = ["src", "prisma", "scripts"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const IGNORE_DIRS = new Set(["node_modules", ".next", "generated", "migrations"]);

const violations = [];

function checkText(file, text) {
  const matches = text.match(/NEXT_PUBLIC_[A-Z0-9_]+/gi) ?? [];
  for (const name of new Set(matches)) {
    if (FORBIDDEN.test(name)) violations.push(`${file}: ${name}`);
  }
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (SCAN_EXTS.has(extname(full))) checkText(full, readFileSync(full, "utf8"));
  }
}

for (const file of [".env.example", ".env"]) {
  try {
    checkText(file, readFileSync(file, "utf8"));
  } catch {
    // .env is absent in CI; that is fine.
  }
}
SCAN_DIRS.forEach(walk);

if (violations.length > 0) {
  console.error("SEC-12 violation — secrets must not be NEXT_PUBLIC_:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log("check:public-env passed — no secret-looking NEXT_PUBLIC_ names.");
