import { serverEnv } from "@/lib/env";

/**
 * The visible half of `DEMO_MODE`.
 *
 * A deployment running the fake payment provider looks exactly like a store
 * that takes money — same checkout, same confirmation, same order number — and
 * the only thing standing between that and someone typing a real card number
 * into it is whether they were told. A warning in a boot log is a warning to
 * the operator; this is the one addressed to the person who might be fooled.
 *
 * Rendered from the root layout, so it is on every route including the
 * prerendered ones: `DEMO_MODE` is read at build time there, which is correct,
 * because it is a fact about the deployment rather than about the request.
 */
export function DemoBanner() {
  if (!serverEnv().DEMO_MODE) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
    >
      <strong className="font-semibold">Demonstration store.</strong> This site takes no
      real payments and ships no real orders. Do not enter a real card number or an
      address you would not post publicly.
    </div>
  );
}
