"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { FormError, FormNotice, TextField } from "@/components/ui/form";
import { Button, CheckboxField } from "@/components/admin/ui";
import { Badge, Td, Th } from "@/components/admin/table";
import type { ShippingOverview } from "@/server/admin/shipping";

/**
 * Zone and rate management.
 *
 * Countries are entered as a comma-separated list of ISO alpha-2 codes, or a
 * single `*`. The server normalises and de-duplicates them and rejects `*`
 * mixed with real codes — a zone that is both "everywhere" and "these three
 * countries" has no coherent matching order.
 */
export function ShippingManager({
  overview,
  currency,
}: {
  overview: ShippingOverview;
  currency: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [addingZone, setAddingZone] = useState(false);
  const [addingRateFor, setAddingRateFor] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    success: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      setNotice(success);
      setAddingZone(false);
      setAddingRateFor(null);
      router.refresh();
    });
  }

  function deleteZone(id: string, name: string) {
    run(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/admin/shipping/zones/${id}`, {
        method: "DELETE",
      });
      return result.ok ? { ok: true } : { ok: false, message: result.error.message };
    }, `Deleted zone ${name} and its rates.`);
  }

  function toggleZone(id: string, isActive: boolean) {
    run(async () => {
      const result = await apiFetch<unknown>(`/api/admin/shipping/zones/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive }),
      });
      return result.ok ? { ok: true } : { ok: false, message: result.error.message };
    }, "Zone updated.");
  }

  function toggleRate(id: string, isActive: boolean) {
    run(async () => {
      const result = await apiFetch<unknown>(`/api/admin/shipping/rates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive }),
      });
      return result.ok ? { ok: true } : { ok: false, message: result.error.message };
    }, "Rate updated.");
  }

  function deleteRate(id: string, name: string) {
    run(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/admin/shipping/rates/${id}`, {
        method: "DELETE",
      });
      return result.ok ? { ok: true } : { ok: false, message: result.error.message };
    }, `Deleted rate ${name}.`);
  }

  return (
    <div className="flex flex-col gap-5">
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      {overview.zones.map((zone) => (
        <section
          key={zone.id}
          className="flex flex-col gap-3 rounded-lg border border-[var(--color-line)] p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {zone.name} {zone.isCatchAll ? <Badge>catch-all</Badge> : null}{" "}
                {zone.isActive ? <Badge tone="good">active</Badge> : <Badge>off</Badge>}
              </h3>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {zone.isCatchAll
                  ? "Matches every destination no other zone claims."
                  : zone.countries.join(", ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={pending}
                onClick={() => toggleZone(zone.id, zone.isActive)}
              >
                {zone.isActive ? "Deactivate" : "Activate"}
              </Button>
              <Button
                tone="danger"
                disabled={pending}
                onClick={() => deleteZone(zone.id, zone.name)}
              >
                Delete zone
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-[var(--color-line)]">
            <table className="w-full min-w-[38rem] border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Rate</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Free over</Th>
                  <Th>Estimate</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody>
                {zone.rates.length === 0 ? (
                  <tr>
                    <Td>
                      <span className="text-[var(--color-muted)]">
                        No rates — nothing in this zone can be shipped.
                      </span>
                    </Td>
                    <Td> </Td>
                    <Td> </Td>
                    <Td> </Td>
                    <Td> </Td>
                  </tr>
                ) : (
                  zone.rates.map((rate) => (
                    <tr key={rate.id}>
                      <Td>
                        {rate.name} {rate.isActive ? null : <Badge>off</Badge>}
                      </Td>
                      <Td align="right">{formatMoney(rate.price, currency)}</Td>
                      <Td align="right">
                        {rate.freeOver ? formatMoney(rate.freeOver, currency) : "—"}
                      </Td>
                      <Td>
                        {rate.minDays}–{rate.maxDays} days
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Button
                            disabled={pending}
                            onClick={() => toggleRate(rate.id, rate.isActive)}
                          >
                            {rate.isActive ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            tone="danger"
                            disabled={pending}
                            onClick={() => deleteRate(rate.id, rate.name)}
                          >
                            Delete
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {addingRateFor === zone.id ? (
            <NewRateForm
              zoneId={zone.id}
              currency={currency}
              pending={pending}
              onSubmit={(body) =>
                run(async () => {
                  const result = await postJson<unknown>(
                    "/api/admin/shipping/rates",
                    body,
                  );
                  return result.ok
                    ? { ok: true }
                    : { ok: false, message: result.error.message };
                }, "Rate added.")
              }
              onCancel={() => setAddingRateFor(null)}
            />
          ) : (
            <div>
              <Button disabled={pending} onClick={() => setAddingRateFor(zone.id)}>
                Add rate
              </Button>
            </div>
          )}
        </section>
      ))}

      {addingZone ? (
        <NewZoneForm
          pending={pending}
          onSubmit={(body) =>
            run(async () => {
              const result = await postJson<unknown>("/api/admin/shipping/zones", body);
              return result.ok
                ? { ok: true }
                : { ok: false, message: result.error.message };
            }, "Zone created.")
          }
          onCancel={() => setAddingZone(false)}
        />
      ) : (
        <div>
          <Button tone="primary" onClick={() => setAddingZone(true)}>
            New zone
          </Button>
        </div>
      )}
    </div>
  );
}

function NewZoneForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [countries, setCountries] = useState("");
  const [isActive, setIsActive] = useState(true);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name: name.trim(),
          countries: countries
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
          isActive,
          position: 0,
        });
      }}
    >
      <h3 className="text-sm font-medium">New shipping zone</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Countries"
          value={countries}
          placeholder="PK, AE, GB — or * for everywhere else"
          hint="Two-letter ISO codes, comma separated."
          disabled={pending}
          onChange={(event) => setCountries(event.target.value)}
        />
      </div>
      <CheckboxField
        label="Active"
        checked={isActive}
        disabled={pending}
        onChange={setIsActive}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" tone="primary" disabled={pending}>
          Create zone
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NewRateForm({
  zoneId,
  currency,
  pending,
  onSubmit,
  onCancel,
}: {
  zoneId: string;
  currency: string;
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [freeOver, setFreeOver] = useState("");
  const [minDays, setMinDays] = useState("3");
  const [maxDays, setMaxDays] = useState("10");

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          zoneId,
          name: name.trim(),
          price: price.trim(),
          freeOver: freeOver.trim() === "" ? null : freeOver.trim(),
          minDays: Number(minDays) || 0,
          maxDays: Number(maxDays) || 0,
          isActive: true,
        });
      }}
    >
      <h3 className="text-sm font-medium">New rate</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <TextField
          label="Name"
          value={name}
          placeholder="Standard"
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={`Price (${currency})`}
          value={price}
          inputMode="decimal"
          disabled={pending}
          onChange={(event) => setPrice(event.target.value)}
        />
        <TextField
          label="Free over"
          value={freeOver}
          inputMode="decimal"
          placeholder="never"
          disabled={pending}
          onChange={(event) => setFreeOver(event.target.value)}
        />
        <TextField
          label="Min days"
          value={minDays}
          inputMode="numeric"
          disabled={pending}
          onChange={(event) => setMinDays(event.target.value)}
        />
        <TextField
          label="Max days"
          value={maxDays}
          inputMode="numeric"
          disabled={pending}
          onChange={(event) => setMaxDays(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" tone="primary" disabled={pending}>
          Add rate
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
