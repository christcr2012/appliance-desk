"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recordManualCustodyAction } from "../actions";

type CustomerOption = { id: string; name: string; serviceAddresses: { id: string; label: string }[] };

/**
 * Who has this appliance right now (from its custody record). When the status says the unit is out but no
 * record says who has it, the owner can record the customer by hand.
 */
export function CustodyPanel({
  applianceId,
  current,
  needsRecord,
  customers,
  canRecord,
}: {
  applianceId: string;
  current: { customerId: string; customerName: string; since: string | null; address: string | null } | null;
  needsRecord: boolean;
  customers: CustomerOption[];
  canRecord: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [since, setSince] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addresses = customers.find((c) => c.id === customerId)?.serviceAddresses ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await recordManualCustodyAction(applianceId, { customerId, serviceAddressId: addressId, startedOn: since, reason });
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (!current && !needsRecord) return null;

  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-medium text-ink">Who has it</h2>
      {current ? (
        <p className="mt-2 text-sm text-ink-soft">
          With{" "}
          <Link href={`/desk/customers/${current.customerId}`} className="text-primary hover:underline">
            {current.customerName}
          </Link>
          {current.address ? ` at ${current.address}` : ""}
          {current.since ? ` since ${current.since}` : " (the start date is not known)"}.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-soft">
            This appliance is marked as out with a customer, but no delivery record says which one.
          </p>
          {canRecord ? (
            <form onSubmit={handleSubmit} className="mt-3 space-y-3">
              <div>
                <label htmlFor="custody-customer" className="block text-sm font-medium text-ink-soft">
                  Customer
                </label>
                <select
                  id="custody-customer"
                  required
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setAddressId("");
                  }}
                  className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                >
                  <option value="">Choose a customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {addresses.length > 0 && (
                <div>
                  <label htmlFor="custody-address" className="block text-sm font-medium text-ink-soft">
                    Address (optional)
                  </label>
                  <select
                    id="custody-address"
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                  >
                    <option value="">Not sure</option>
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="custody-since" className="block text-sm font-medium text-ink-soft">
                  Since (optional)
                </label>
                <input
                  id="custody-since"
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  className="mt-1 rounded-md border border-line-strong px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-ink-soft">Leave blank if you don&apos;t know. The app never guesses a date.</p>
              </div>
              <div>
                <label htmlFor="custody-reason" className="block text-sm font-medium text-ink-soft">
                  How do you know?
                </label>
                <input
                  id="custody-reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. confirmed by phone"
                  className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Record customer"}
              </button>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </form>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">An owner or admin can record who has it.</p>
          )}
        </>
      )}
    </div>
  );
}
