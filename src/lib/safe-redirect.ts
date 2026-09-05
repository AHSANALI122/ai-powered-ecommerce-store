/**
 * Open-redirect guard.
 *
 * `?next=` values reach us from links and forms, so they are attacker
 * controlled. Only a same-site, single-slash absolute path is allowed:
 * `//evil.com` is a protocol-relative URL that browsers happily follow off
 * site, and `https://evil.com` obviously is too.
 */
export function safeRelativePath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  // A backslash is normalised to a slash by some browsers; treat it as hostile.
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return fallback;
  }
  return value;
}
