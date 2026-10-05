import Link from "next/link";
import { getWaitingForStripe } from "@/domains/billing/waiting-for-stripe";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

/** What Stripe has been asked to do and has not finished. Read-only: retries belong to the nightly pass. */
export async function WaitingTab() {
  const { operations, operationCount, endings } = await getWaitingForStripe();
  const none = operations.length === 0 && endings.length === 0;
  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-ink-soft">
        These are requests we sent (or are about to send) to Stripe that are not finished. There is nothing to press here:
        the system retries them every night. If one stays here, open the{" "}
        <Link className="text-primary underline" href="/desk/billing/reconciliation">
          reconciliation page
        </Link>{" "}
        to compare our records with Stripe&apos;s.
      </p>
      {none && <p className="text-sm text-gray-600">Nothing is waiting for Stripe.</p>}
      {operations.length > 0 && (
        <section aria-labelledby="ops-h">
          <h2 id="ops-h" className="text-base font-semibold text-gray-900">
            Requests not confirmed ({operationCount})
          </h2>
          <ul className="mt-3 space-y-3">
            {operations.map((o) => (
              <li key={o.id} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
                <p className="font-medium text-gray-900">
                  {o.what} <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">{o.status}</span>
                </p>
                <p className="mt-1 text-gray-700">{o.meaning}</p>
                <p className="mt-1 text-xs text-gray-600">
                  Asked {formatBusinessDate(o.since)} · {formatBusinessTime(o.since)} · tried {o.attempts} time(s)
                </p>
                {o.lastError && <p className="mt-1 text-xs text-gray-600">Last message from Stripe: {o.lastError}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {endings.length > 0 && (
        <section aria-labelledby="end-h">
          <h2 id="end-h" className="text-base font-semibold text-gray-900">
            Billing end dates not applied yet ({endings.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {endings.map((e) => (
              <li key={e.stripeSubscriptionId} className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
                <p className="font-medium text-gray-900">{e.what}</p>
                <p className="mt-1 text-xs text-gray-600">
                  <Link className="text-primary underline" href={`/desk/agreements/${e.agreementId}`}>
                    Open the rental
                  </Link>{" "}
                  · waiting since {formatBusinessDate(e.since)} · tried {e.attempts} time(s)
                </p>
                {e.lastError && <p className="mt-1 text-xs text-gray-600">Last message: {e.lastError}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
