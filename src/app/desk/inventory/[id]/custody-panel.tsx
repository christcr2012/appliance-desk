"use client";

import { useRef, useState, useTransition } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchablePicker } from "@/components/kit";
import {
  getCustomerAddressOptionsAction,
  recordManualCustodyAction,
  searchCustomersAction,
} from "../actions";

/**
 * Who has this appliance right now (from its custody record). When the
 * status says the unit is out but no record says who has it, the owner can
 * record the customer by hand.
 *
 * AR-6 fix 6: the customer is picked with the searchable picker (the desk
 * search), never a select holding every customer. The address options load
 * for the picked customer when the address field is first used.
 */
export function CustodyPanel({
  applianceId,
  current,
  needsRecord,
  canRecord,
}: {
  applianceId: string;
  current: { customerId: string; customerName: string; since: string | null; address: string | null } | null;
  needsRecord: boolean;
  canRecord: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [addresses, setAddresses] = useState<{ id: string; label: string }[]>([]);
  const [addressesFor, setAddressesFor] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  if (!current && !needsRecord) return null;

  function loadAddresses() {
    const form = formRef.current;
    if (!form) return;
    const customerId = String(new FormData(form).get("customerId") ?? "");
    if (!customerId || customerId === addressesFor) return;
    setAddressesFor(customerId);
    getCustomerAddressOptionsAction(customerId)
      .then(setAddresses)
      .catch(() => setAddresses([]));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const customerId = String(fd.get("customerId") ?? "");
    if (!customerId) {
      setError("Pick the customer first — type at least 2 letters to search.");
      return;
    }
    startTransition(async () => {
      const result = await recordManualCustodyAction(applianceId, {
        customerId,
        serviceAddressId: String(fd.get("serviceAddressId") ?? ""),
        startedOn: String(fd.get("startedOn") ?? ""),
        reason: String(fd.get("reason") ?? ""),
      });
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  return (
    <div id="custody" className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-medium text-ink">Who has it <InfoTip term="custody" /></h2>
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
            <form ref={formRef} onSubmit={handleSubmit} className="mt-3 space-y-3">
              <SearchablePicker name="customerId" label="Customer" search={searchCustomersAction} />
              <div>
                <label htmlFor="custody-address" className="block text-sm font-medium text-ink-soft">
                  Address (optional)
                </label>
                <select
                  id="custody-address"
                  name="serviceAddressId"
                  defaultValue=""
                  onFocus={loadAddresses}
                  onClick={loadAddresses}
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
              <div>
                <label htmlFor="custody-since" className="block text-sm font-medium text-ink-soft">
                  Since (optional)
                </label>
                <input
                  id="custody-since"
                  name="startedOn"
                  type="date"
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
                  name="reason"
                  required
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
