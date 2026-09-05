import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { listAddresses } from "@/server/addresses/service";
import { AddressBook } from "./address-book";

export const metadata: Metadata = {
  title: "Your addresses",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Address book (F3, SEC-23). Owner-scoped read; the writes are too. */
export default async function AddressesPage() {
  const user = await requireUser();
  const addresses = await listAddresses(user.id);

  return (
    <div className="flex flex-col gap-6 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your addresses</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          The default address is offered first at checkout. Orders keep a copy of the
          address they were sent to, so editing one here never changes a past order.
        </p>
      </header>

      <AddressBook initialAddresses={addresses} />
    </div>
  );
}
