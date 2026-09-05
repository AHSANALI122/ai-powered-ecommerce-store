import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with argon2id (F1).
 *
 * Parameters follow the OWASP minimum for argon2id (19 MiB, t=2, p=1). They
 * are recorded inside the PHC string, so raising them later still verifies old
 * hashes — `needsRehash` tells a login handler when to upgrade one in place.
 */

// `algorithm` is omitted deliberately: @node-rs/argon2 defaults to Argon2id,
// and its `Algorithm` enum is an ambient const enum that cannot be imported
// under `verbatimModuleSyntax`. The chosen variant is recorded in the PHC
// string of every hash, so this is verifiable rather than assumed.
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Argon2 has no practical input limit, but an unbounded body is a DoS vector. */
export const MAX_PASSWORD_LENGTH = 200;
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError("Password exceeds the maximum supported length.");
  }
  return hash(password, OPTIONS);
}

/**
 * Verifies a password against a stored hash. Never throws on a malformed or
 * corrupt hash — a bad row must read as "wrong password", not as a 500 that
 * tells an attacker the account exists (SEC-9).
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    return await verify(storedHash, password, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the same CPU as a real verification. Called on the "no such
 * user" branch of login so response timing does not disclose whether an email
 * is registered (SEC-9).
 */
export async function fakeVerifyPassword(): Promise<false> {
  await hash("timing-equalisation-dummy-password", OPTIONS);
  return false;
}
