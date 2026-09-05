/**
 * Which links the assistant is allowed to render (SEC-2).
 *
 * Its own module so it can be tested without a DOM, and because it is a
 * security rule wearing a formatting rule's clothes. The model is instructed
 * to link to products with `[Title](/p/slug)`. Product descriptions and
 * customer reviews reach the model as data — neutralised and fenced, but
 * still text a stranger wrote — and the failure this closes is a model that
 * has been talked into emitting `[Track your order](https://evil.example)`
 * into a chat bubble on this origin.
 *
 * The rule is an allowlist of internal paths, not a denylist of bad schemes.
 * `javascript:`, `data:`, `//host`, `https://` and a protocol the browser has
 * not invented yet all fail the same way: by not being on the list.
 */

/** `[label](/path)` — bounded label, internal path characters only. */
export const MARKDOWN_LINK = /\[([^\]\n]{1,80})\]\((\/[A-Za-z0-9\-._~/]{0,120})\)/g;

/** The four storefront areas an answer has any reason to point at. */
const ALLOWED_PATH = /^\/(p|c|search|cart)(\/|$)/;

export function isAllowedAssistantLink(href: string): boolean {
  // `//evil.example` is protocol-relative and reaches another origin, but it
  // starts with a slash and so would otherwise look internal.
  if (href.startsWith("//")) return false;
  // A backslash is treated as a slash by some URL parsers; there is no
  // legitimate one in a storefront path.
  if (href.includes("\\")) return false;
  // `/p/../../admin` normalises out of the allowed area.
  if (href.includes("..")) return false;
  return ALLOWED_PATH.test(href);
}
