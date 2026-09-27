"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDraftAgreementAction } from "../actions";

type CustomerOption = {
  id: string;
  name: string;
  serviceAddresses: { id: string; label: string }[];
};

const EMPTY_FIELDS = {
  termMonths: "",
  depositDollars: "",
  damageWaiverDollars: "",
  lateFeeGraceDays: "5",
  lateFeeDollars: "",
  lateFeePercent: "",
  taxRatePercent: "",
  paidInFullInAdvance: false,
};

export function NewAgreementForm({
  customers,
  initialCustomerId,
}: {
  customers: CustomerOption[];
  initialCustomerId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState(
    initialCustomerId ?? customers[0]?.id ?? "",
  );
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const [serviceAddressId, setServiceAddressId] = useState(
    selectedCustomer?.serviceAddresses[0]?.id ?? "",
  );
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof EMPTY_FIELDS>(
    key: K,
    value: (typeof EMPTY_FIELDS)[K],
  ) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleCustomerChange(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setServiceAddressId(c?.serviceAddresses[0]?.id ?? "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDraftAgreementAction({
        customerId,
        serviceAddressId,
        ...fields,
      });
      if (result.status === "error") {
        setError(result.message);
      } else {
        router.push(`/desk/agreements/${result.agreementId}`);
      }
    });
  }

  const addresses = selectedCustomer?.serviceAddresses ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div>
        <label htmlFor="customerId" className="block text-sm font-medium text-gray-700">
          Customer
        </label>
        <select
          id="customerId"
          value={customerId}
          onChange={(e) => handleCustomerChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="serviceAddressId" className="block text-sm font-medium text-gray-700">
          Service address
        </label>
        {addresses.length === 0 ? (
          <p className="mt-1 text-sm text-red-700">
            This customer has no service address on file yet.
          </p>
        ) : (
          <select
            id="serviceAddressId"
            value={serviceAddressId}
            onChange={(e) => setServiceAddressId(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="termMonths" className="block text-sm font-medium text-gray-700">
            Term (months, optional)
          </label>
          <input
            id="termMonths"
            type="number"
            min={1}
            placeholder="Leave blank for month-to-month"
            value={fields.termMonths}
            onChange={(e) => {
              const value = e.target.value;
              update("termMonths", value);
              if (value !== "12") update("paidInFullInAdvance", false);
            }}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {(fields.termMonths === "6" || fields.termMonths === "12") && (
            <p className="mt-1 text-xs text-gray-500">
              A {fields.termMonths}-month term automatically gets the {fields.termMonths}
              -month prepay discount (set from /desk/settings).
            </p>
          )}
        </div>
        <div>
          <label htmlFor="depositDollars" className="block text-sm font-medium text-gray-700">
            Deposit ($, optional)
          </label>
          <input
            id="depositDollars"
            type="number"
            min={0}
            step="0.01"
            value={fields.depositDollars}
            onChange={(e) => update("depositDollars", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {fields.termMonths === "12" && (
        <label className="flex items-center gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
          <input
            type="checkbox"
            checked={fields.paidInFullInAdvance}
            onChange={(e) => update("paidInFullInAdvance", e.target.checked)}
            className="h-4 w-4"
          />
          Customer is paying the full 12 months in advance (earns the free-month bonus,
          if that&apos;s turned on in Settings)
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="damageWaiverDollars"
            className="block text-sm font-medium text-gray-700"
          >
            Damage waiver ($/mo, optional)
          </label>
          <input
            id="damageWaiverDollars"
            type="number"
            min={0}
            step="0.01"
            value={fields.damageWaiverDollars}
            onChange={(e) => update("damageWaiverDollars", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="taxRatePercent" className="block text-sm font-medium text-gray-700">
            Tax rate (%, optional)
          </label>
          <input
            id="taxRatePercent"
            type="number"
            min={0}
            step="0.01"
            value={fields.taxRatePercent}
            onChange={(e) => update("taxRatePercent", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="lateFeeGraceDays"
            className="block text-sm font-medium text-gray-700"
          >
            Late fee grace (days)
          </label>
          <input
            id="lateFeeGraceDays"
            type="number"
            min={0}
            value={fields.lateFeeGraceDays}
            onChange={(e) => update("lateFeeGraceDays", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lateFeeDollars" className="block text-sm font-medium text-gray-700">
            Late fee flat ($)
          </label>
          <input
            id="lateFeeDollars"
            type="number"
            min={0}
            step="0.01"
            value={fields.lateFeeDollars}
            onChange={(e) => update("lateFeeDollars", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lateFeePercent" className="block text-sm font-medium text-gray-700">
            Late fee (%)
          </label>
          <input
            id="lateFeePercent"
            type="number"
            min={0}
            step="0.01"
            value={fields.lateFeePercent}
            onChange={(e) => update("lateFeePercent", e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || addresses.length === 0}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create draft agreement"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
