"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addServiceAddressAction } from "../actions";
// Imported from ./money directly, not "@/domains/pricing" — that
// index also pulls in @/lib/prisma (the `pg` driver), which breaks the
// client bundle for this "use client" component. See that index's own
// comment for why the split exists.
import { formatCents } from "@/domains/pricing/money";
import { PropertyServiceIcon } from "@/components/icons/service-icons";

type Address = {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
};

type AgreementAtAddress = {
  id: string;
  status: string;
  serviceAddressId: string;
  monthlyCents: number;
};

type JobAtAddress = {
  id: string;
  serviceAddressId: string | null;
};

function addressLine(a: Address): string {
  return `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.state} ${a.zip}`;
}

/** A customer's properties, one card each with what's happening there —
 * the "portfolio rollup" a property manager with several buildings
 * needs, and the only place to add another property to a customer who
 * already exists (previously a direct database edit — see
 * docs/BUSINESS-RULES.md's "Property managers / portfolio accounts").
 * For a one-address household customer this just shows the one card;
 * the grouping only starts to matter once there's more than one. */
export function ServiceAddressesPanel({
  customerId,
  addresses,
  agreements,
  jobs,
}: {
  customerId: string;
  addresses: Address[];
  agreements: AgreementAtAddress[];
  jobs: JobAtAddress[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await addServiceAddressAction(customerId, {
        line1: String(data.get("line1") ?? ""),
        line2: String(data.get("line2") ?? ""),
        city: String(data.get("city") ?? ""),
        state: String(data.get("state") ?? ""),
        zip: String(data.get("zip") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setError(null);
      formRef.current?.reset();
      setShowForm(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-medium text-ink">
          <PropertyServiceIcon className="h-4 w-4 text-ink-faint" />
          {addresses.length > 1 ? "Properties" : "Service address"}
        </h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
        >
          {showForm ? "Cancel" : "+ Add property"}
        </button>
      </div>

      {addresses.length === 0 && !showForm && (
        <p className="mt-2 text-sm text-ink-soft">None on file.</p>
      )}

      {addresses.length > 0 && (
        <ul className="mt-3 space-y-3">
          {addresses.map((a) => {
            const atThisAddress = agreements.filter(
              (ag) => ag.serviceAddressId === a.id,
            );
            const activeAtThisAddress = atThisAddress.filter(
              (ag) => ag.status === "ACTIVE",
            );
            const monthlyTotal = activeAtThisAddress.reduce(
              (sum, ag) => sum + ag.monthlyCents,
              0,
            );
            const jobCount = jobs.filter(
              (j) => j.serviceAddressId === a.id,
            ).length;

            return (
              <li
                key={a.id}
                className="rounded-md border border-line p-3 text-sm"
              >
                <p className="font-medium text-ink">{addressLine(a)}</p>
                <p className="mt-1 text-ink-soft">
                  {atThisAddress.length === 0
                    ? "No agreements here yet"
                    : `${atThisAddress.length} agreement(s)${
                        activeAtThisAddress.length > 0
                          ? ` — ${formatCents(monthlyTotal)}/mo active`
                          : ""
                      }`}
                  {jobCount > 0 && ` · ${jobCount} upcoming job(s)`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/desk/agreements/new?customerId=${encodeURIComponent(customerId)}&serviceAddressId=${encodeURIComponent(a.id)}`}
                    className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 py-2 text-primary hover:bg-subtle"
                  >
                    New rental here
                  </Link>
                  <Link
                    href={`/desk/jobs/new?customerId=${encodeURIComponent(customerId)}&serviceAddressId=${encodeURIComponent(a.id)}`}
                    className="inline-flex min-h-11 items-center rounded-lg border border-control px-3 py-2 text-primary hover:bg-subtle"
                  >
                    Schedule visit here
                  </Link>
                  <Link
                    href={`/desk/customers/${encodeURIComponent(customerId)}?tab=service`}
                    className="inline-flex min-h-11 items-center text-primary underline"
                  >
                    Service requests
                  </Link>
                </div>
                {atThisAddress.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {atThisAddress.map((ag) => (
                      <li key={ag.id}>
                        <Link
                          href={`/desk/agreements/${ag.id}`}
                          className="text-primary hover:underline"
                        >
                          {ag.status} agreement
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <form ref={formRef} onSubmit={handleAdd} className="mt-4 space-y-2">
          <input
            name="line1"
            aria-label="Street address"
            required
            placeholder="Street address"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
          <input
            name="line2"
            aria-label="Unit or suite"
            placeholder="Unit / suite (optional)"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <input
              name="city"
              aria-label="City"
              required
              placeholder="City"
              className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
            />
            <input
              name="state"
              aria-label="State"
              defaultValue="CO"
              placeholder="State"
              className="w-20 rounded-md border border-line-strong px-3 py-1.5 text-sm"
            />
            <input
              name="zip"
              aria-label="ZIP code"
              required
              placeholder="ZIP"
              className="w-28 rounded-md border border-line-strong px-3 py-1.5 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save property"}
          </button>
        </form>
      )}
    </div>
  );
}
