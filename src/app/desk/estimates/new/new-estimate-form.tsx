"use client";

import { useState, useTransition } from "react";
import { createEstimateAction } from "../actions";

type CustomerOption = {
  id: string;
  name: string;
  companyName: string | null;
  isPropertyManager: boolean;
};

export function NewEstimateForm({
  customers,
  initialCustomerId,
}: {
  customers: CustomerOption[];
  initialCustomerId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [title, setTitle] = useState("");
  const [clientMessage, setClientMessage] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [depositDollars, setDepositDollars] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Property managers/business accounts surfaced first — the customers
  // this feature is actually for, per Chris's own framing.
  const sortedCustomers = [...customers].sort((a, b) => {
    if (a.isPropertyManager !== b.isPropertyManager) return a.isPropertyManager ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createEstimateAction({
        customerId,
        title,
        clientMessage,
        internalNotes,
        depositDollars,
        validUntil,
      });
      if (result && result.status === "error") {
        setError(result.message);
      }
      // On success this redirects server-side to the new estimate's page.
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label htmlFor="customerId" className="block text-sm font-medium text-gray-700">
          Customer
        </label>
        <select
          id="customerId"
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Choose a customer…</option>
          {sortedCustomers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.companyName ? ` — ${c.companyName}` : ""}
              {c.isPropertyManager ? " (property manager)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700">
          Internal title
        </label>
        <input
          id="title"
          type="text"
          required
          placeholder="e.g. Sunset Apartments — 12 units"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          For your own reference — the customer only ever sees &quot;Estimate
          #123.&quot;
        </p>
      </div>

      <div>
        <label htmlFor="clientMessage" className="block text-sm font-medium text-gray-700">
          Message to the customer (optional)
        </label>
        <textarea
          id="clientMessage"
          rows={3}
          value={clientMessage}
          onChange={(e) => setClientMessage(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="internalNotes" className="block text-sm font-medium text-gray-700">
          Internal notes (optional, never shown to the customer)
        </label>
        <textarea
          id="internalNotes"
          rows={2}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="depositDollars" className="block text-sm font-medium text-gray-700">
            Deposit ($, optional)
          </label>
          <input
            id="depositDollars"
            type="number"
            min="0"
            step="0.01"
            value={depositDollars}
            onChange={(e) => setDepositDollars(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="validUntil" className="block text-sm font-medium text-gray-700">
            Valid until (optional)
          </label>
          <input
            id="validUntil"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create draft estimate"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
