import Link from "next/link";
import { runtimeRoute } from "@/lib/routes";
import {
  MARKDOWN_LINK,
  isAllowedAssistantLink,
} from "@/components/assistant/link-policy";

/**
 * The assistant's answers, rendered.
 *
 * A markdown library is not worth the bundle here, and more to the point it is
 * not worth the surface: the model's output is text a shopper reads, and the
 * only structure it needs is a link to a product and the occasional bullet.
 * Everything else stays literal, so an answer containing a stray `<img
 * onerror=…>` renders as those characters — React escapes it — rather than
 * going anywhere near `dangerouslySetInnerHTML`.
 *
 * Links are the part that has to be careful, and the rule for them lives in
 * link-policy.ts — see the reasoning there. Anything that does not pass it
 * renders as the literal source text, so the shopper sees exactly what was
 * said and can click none of it.
 */

function renderLine(line: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MARKDOWN_LINK.lastIndex = 0;
  while ((match = MARKDOWN_LINK.exec(line)) !== null) {
    const [full, label, href] = match;
    if (match.index > lastIndex) nodes.push(line.slice(lastIndex, match.index));

    if (href && label && isAllowedAssistantLink(href)) {
      nodes.push(
        <Link
          key={`${keyPrefix}-${match.index}`}
          href={runtimeRoute(href)}
          className="font-medium underline underline-offset-4"
        >
          {label}
        </Link>,
      );
    } else {
      // Not a link the assistant is allowed to make: show the source text so
      // the shopper can see exactly what was said, and click nothing.
      nodes.push(full);
    }
    lastIndex = match.index + full.length;
  }

  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

export function RichText({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="flex flex-col gap-1 whitespace-pre-wrap break-words">
      {lines.map((line, index) => {
        const bullet = /^\s*[-*]\s+/.exec(line);
        const content = bullet ? line.slice(bullet[0].length) : line;
        if (content.trim().length === 0) return null;

        return bullet ? (
          <div key={index} className="flex gap-2 pl-1">
            <span aria-hidden="true" className="text-[var(--color-muted)]">
              •
            </span>
            <span>{renderLine(content, String(index))}</span>
          </div>
        ) : (
          <p key={index}>{renderLine(content, String(index))}</p>
        );
      })}
    </div>
  );
}
