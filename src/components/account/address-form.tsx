"use client";

import { useState, useTransition } from "react";
import { apiFetch } from "@/lib/client/api";
import { FormError, SubmitButton, TextField } from "@/components/ui/form";

/**
 * Create/edit an address (F3).
 *
 * Shared by the checkout screen and the account address book so the two cannot
 * validate differently. There is no `userId` field and no way to add one: the
 * server takes ownership from the session (SEC-23).
 */

export interface Address {
  id: string;
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

type FieldErrors = Record<string, string[]>;

export function AddressForm({
  address,
  onSaved,
  onCancel,
  submitLabel = "Save address",
}: {
  address?: Address;
  onSaved: (address: Address) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});

    // Empty optional inputs are dropped rather than sent as "". The schema
    // treats them as absent, and a blank line2 is not a value.
    const body: Record<string, unknown> = { isDefault: form.get("isDefault") === "on" };
    for (const key of [
      "fullName",
      "phone",
      "line1",
      "line2",
      "city",
      "state",
      "postalCode",
      "country",
    ] as const) {
      const value = String(form.get(key) ?? "").trim();
      if (value) body[key] = value;
    }

    startTransition(async () => {
      const result = await apiFetch<{ address: Address }>(
        address ? `/api/account/addresses/${address.id}` : "/api/account/addresses",
        { method: address ? "PATCH" : "POST", body: JSON.stringify(body) },
      );

      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      onSaved(result.data.address);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FormError>{error}</FormError>

      <TextField
        label="Full name"
        name="fullName"
        defaultValue={address?.fullName ?? ""}
        required
        autoComplete="name"
        errors={fieldErrors.fullName}
      />
      <TextField
        label="Address line 1"
        name="line1"
        defaultValue={address?.line1 ?? ""}
        required
        autoComplete="address-line1"
        errors={fieldErrors.line1}
      />
      <TextField
        label="Address line 2"
        name="line2"
        defaultValue={address?.line2 ?? ""}
        autoComplete="address-line2"
        errors={fieldErrors.line2}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="City"
          name="city"
          defaultValue={address?.city ?? ""}
          required
          autoComplete="address-level2"
          errors={fieldErrors.city}
        />
        <TextField
          label="State or province"
          name="state"
          defaultValue={address?.state ?? ""}
          autoComplete="address-level1"
          errors={fieldErrors.state}
        />
        <TextField
          label="Postal code"
          name="postalCode"
          defaultValue={address?.postalCode ?? ""}
          autoComplete="postal-code"
          errors={fieldErrors.postalCode}
        />
        <TextField
          label="Country"
          name="country"
          defaultValue={address?.country ?? ""}
          required
          maxLength={2}
          hint="Two-letter code, e.g. PK, GB, US. Delivery zone and cost follow from it."
          autoComplete="country"
          errors={fieldErrors.country}
        />
      </div>
      <TextField
        label="Phone"
        name="phone"
        type="tel"
        defaultValue={address?.phone ?? ""}
        autoComplete="tel"
        errors={fieldErrors.phone}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={address?.isDefault ?? false}
          className="size-4"
        />
        Use as my default delivery address
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-[var(--color-muted)] underline underline-offset-4"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
