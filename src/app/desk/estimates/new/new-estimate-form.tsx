"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createEstimateAction, createEstimateForNewLeadAction } from "../actions";

type CustomerOption = {
  id: string;
  name: string;
  companyName: string | null;
  isPropertyManager: boolean;
};

// Chris flagged (2026-09-29) that there was no way to start an estimate
// for someone who isn't already a customer — see
// docs/DECISIONS.md. This form now covers both: an existing customer
// (the original flow, unchanged), or someone brand new, in which case
// submitting this creates a Lead for them first (shows up in the
// ordinary /desk/leads pipeline right away) and starts the estimate
// against that instead — see createEstimateDraftForNewLead's own
// comment for what happens once they approve it.
type Mode = "existing" | "new";

export function NewEstimateForm({
  customers,
  initialCustomerId,
}: {
  customers: CustomerOption[];
  initialCustomerId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(
    customers.length === 0 ? "new" : "existing",
  );
  const [customerId, setCustomerId] = useState(initialCustomerId ?? "");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadCompanyName, setLeadCompanyName] = useState("");
  const [leadIsBusiness, setLeadIsBusiness] = useState(false);
  const [leadIsPropertyManager, setLeadIsPropertyManager] = useState(false);
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
      const result =
        mode === "existing"
          ? await createEstimateAction({
              customerId,
              title,
              clientMessage,
              internalNotes,
              depositDollars,
              validUntil,
            })
          : await createEstimateForNewLeadAction({
              contactName,
              phone,
              email: leadEmail,
              companyName: leadCompanyName,
              isBusiness: leadIsBusiness,
              isPropertyManager: leadIsPropertyManager,
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
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-line bg-white p-5">
      <div>
        <span className="block text-sm font-medium text-ink-soft">Who&apos;s this for?</span>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("existing")}
            disabled={customers.length === 0}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              mode === "existing"
                ? "border-primary bg-action text-on-action"
                : "border-line-strong text-ink-soft hover:border-line-strong disabled:opacity-40"
            }`}
          >
            An existing customer
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              mode === "new"
                ? "border-primary bg-action text-on-action"
                : "border-line-strong text-ink-soft hover:border-line-strong"
            }`}
          >
            Someone new
          </button>
        </div>
        {customers.length === 0 && mode === "existing" && (
          <p className="mt-1 text-xs text-ink-faint">
            No customers yet — pick &quot;Someone new&quot; instead.
          </p>
        )}
      </div>

      {mode === "existing" ? (
        <div>
          <label htmlFor="customerId" className="block text-sm font-medium text-ink-soft">
            Customer
          </label>
          <select
            id="customerId"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
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
      ) : (
        <div className="space-y-4 rounded-md border border-line p-3">
          <p className="text-xs text-ink-faint">
            This creates a lead for them first — it&apos;ll show up in{" "}
            <Link href="/desk/leads" className="underline">
              Leads
            </Link>{" "}
            right away. They become a real customer automatically once they
            approve this estimate.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="contactName" className="block text-xs font-medium text-ink-soft">
                Name
              </label>
              <input
                id="contactName"
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-xs font-medium text-ink-soft">
                Phone
              </label>
              <input
                id="phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="leadEmail" className="block text-xs font-medium text-ink-soft">
                Email (optional for now)
              </label>
              <input
                id="leadEmail"
                type="email"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="leadCompanyName" className="block text-xs font-medium text-ink-soft">
                Company name (if any)
              </label>
              <input
                id="leadCompanyName"
                value={leadCompanyName}
                onChange={(e) => setLeadCompanyName(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={leadIsBusiness}
                onChange={(e) => setLeadIsBusiness(e.target.checked)}
              />
              This is a business account
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={leadIsPropertyManager}
                onChange={(e) => setLeadIsPropertyManager(e.target.checked)}
              />
              They&apos;re a landlord, property manager, or apartment
              operator managing multiple properties
            </label>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-ink-soft">
          Internal title
        </label>
        <input
          id="title"
          type="text"
          required
          placeholder="e.g. Sunset Apartments — 12 units"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-ink-faint">
          For your own reference — the customer only ever sees &quot;Estimate
          #123.&quot;
        </p>
      </div>

      <div>
        <label htmlFor="clientMessage" className="block text-sm font-medium text-ink-soft">
          Message to the customer (optional)
        </label>
        <textarea
          id="clientMessage"
          rows={3}
          value={clientMessage}
          onChange={(e) => setClientMessage(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="internalNotes" className="block text-sm font-medium text-ink-soft">
          Internal notes (optional, never shown to the customer)
        </label>
        <textarea
          id="internalNotes"
          rows={2}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="depositDollars" className="block text-sm font-medium text-ink-soft">
            Deposit ($, optional)
          </label>
          <input
            id="depositDollars"
            type="number"
            min="0"
            step="0.01"
            value={depositDollars}
            onChange={(e) => setDepositDollars(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="validUntil" className="block text-sm font-medium text-ink-soft">
            Valid until (optional)
          </label>
          <input
            id="validUntil"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
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
