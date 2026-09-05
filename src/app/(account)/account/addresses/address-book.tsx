"use client";

import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { AddressForm, type Address } from "@/components/account/address-form";

/**
 * Address book CRUD.
 *
 * Deletion has no confirm dialog and no undo yet — it is a cheap thing to lose
 * and a cheap thing to re-enter, and orders keep their own snapshot, so
 * removing an address cannot damage history (spec §5).
 */
export function AddressBook({ initialAddresses }: { initialAddresses: Address[] }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(initialAddresses.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function replace(saved: Address) {
    setAddresses((current) => {
      const others = current
        .filter((entry) => entry.id !== saved.id)
        // Only one address may be the default; adopt the server's decision.
        .map((entry) => (saved.isDefault ? { ...entry, isDefault: false } : entry));
      return saved.isDefault ? [saved, ...others] : [...others, saved];
    });
    setEditing(null);
    setAdding(false);
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/account/addresses/${id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAddresses((current) => current.filter((entry) => entry.id !== id));
    });
  }

  function makeDefault(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await apiFetch<{ address: Address }>(
        `/api/account/addresses/${id}`,
        { method: "PATCH", body: JSON.stringify({ isDefault: true }) },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      replace(result.data.address);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {addresses.map((address) => (
          <li
            key={address.id}
            className="rounded-lg border border-[var(--color-line)] p-4"
          >
            {editing === address.id ? (
              <AddressForm
                address={address}
                onSaved={replace}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium">
                    {address.fullName}
                    {address.isDefault ? (
                      <span className="ml-2 rounded border border-[var(--color-line)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--color-muted)]">
                        default
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[var(--color-muted)]">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ""}, {address.city}
                    {address.postalCode ? ` ${address.postalCode}` : ""},{" "}
                    {address.country}
                  </p>
                  {address.phone ? (
                    <p className="text-[var(--color-muted)]">{address.phone}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  {!address.isDefault ? (
                    <button
                      type="button"
                      onClick={() => makeDefault(address.id)}
                      disabled={pending}
                      className="underline underline-offset-4 disabled:opacity-50"
                    >
                      Make default
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEditing(address.id)}
                    className="underline underline-offset-4"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(address.id)}
                    disabled={pending}
                    className="text-[var(--color-muted)] underline underline-offset-4 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="rounded-lg border border-[var(--color-line)] p-4">
          <AddressForm
            onSaved={replace}
            onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start rounded-md border border-[var(--color-line)] px-4 py-2 text-sm font-medium"
        >
          Add an address
        </button>
      )}
    </div>
  );
}
