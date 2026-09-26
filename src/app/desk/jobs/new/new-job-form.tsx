"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJobAction } from "../actions";

type CustomerOption = {
  id: string;
  name: string;
  serviceAddresses: { id: string; label: string }[];
};

type AgreementContext = {
  id: string;
  customerId: string;
  serviceAddressId: string;
  appliances: { id: string; label: string }[];
};

const JOB_TYPES: { value: string; label: string }[] = [
  { value: "DELIVERY", label: "Delivery" },
  { value: "INSTALLATION", label: "Installation" },
  { value: "SWAP", label: "Swap" },
  { value: "MAINTENANCE_VISIT", label: "Maintenance visit" },
  { value: "REMOVAL", label: "Removal" },
];

export function NewJobForm({
  customers,
  agreement,
}: {
  customers: CustomerOption[];
  agreement: AgreementContext | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState(agreement ? "DELIVERY" : "MAINTENANCE_VISIT");
  const [customerId, setCustomerId] = useState(agreement?.customerId ?? customers[0]?.id ?? "");
  const selectedCustomer = customers.find((c) => c.id === customerId);
  const [serviceAddressId, setServiceAddressId] = useState(
    agreement?.serviceAddressId ?? selectedCustomer?.serviceAddresses[0]?.id ?? "",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedApplianceIds, setSelectedApplianceIds] = useState<string[]>(
    agreement?.appliances.map((a) => a.id) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  function toggleAppliance(id: string) {
    setSelectedApplianceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
      const result = await createJobAction({
        type,
        scheduledAt,
        customerId,
        serviceAddressId,
        agreementId: agreement?.id ?? "",
        applianceIds: selectedApplianceIds,
        notes,
      });
      if (result.status === "error") {
        setError(result.message);
      } else {
        router.push(`/desk/jobs/${result.jobId}`);
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
        <label htmlFor="type" className="block text-sm font-medium text-gray-700">
          Job type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {JOB_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="scheduledAt" className="block text-sm font-medium text-gray-700">
          When (optional)
        </label>
        <input
          id="scheduledAt"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {!agreement && (
        <>
          <div>
            <label htmlFor="customerId" className="block text-sm font-medium text-gray-700">
              Customer (optional)
            </label>
            <select
              id="customerId"
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No specific customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {addresses.length > 0 && (
            <div>
              <label
                htmlFor="serviceAddressId"
                className="block text-sm font-medium text-gray-700"
              >
                Service address
              </label>
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
            </div>
          )}
        </>
      )}

      {agreement && agreement.appliances.length > 0 && (
        <div>
          <p className="block text-sm font-medium text-gray-700">
            Appliances on this agreement
          </p>
          <div className="mt-2 space-y-1 rounded-md border border-gray-200 p-2">
            {agreement.appliances.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedApplianceIds.includes(a.id)}
                  onChange={() => toggleAppliance(a.id)}
                />
                {a.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Scheduling…" : "Schedule job"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
