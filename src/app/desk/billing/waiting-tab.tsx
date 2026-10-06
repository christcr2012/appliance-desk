import Link from "next/link";
import { getWaitingForStripe } from "@/domains/billing/waiting-for-stripe";
import {
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import {
  ButtonLink,
  Card,
  EmptyState,
  StatusPill,
} from "@/components/ui";

export async function WaitingTab() {
  const { operations, operationCount, endings } =
    await getWaitingForStripe();
  const none = operations.length === 0 && endings.length === 0;

  return (
    <div className="space-y-6">
      <Card
        title="Waiting for Stripe"
        description="These requests have been sent, or are ready to be sent, but Stripe has not confirmed completion. The nightly process retries them automatically."
        actions={
          <ButtonLink
            href="/desk/billing/reconciliation"
            variant="secondary"
          >
            Open reconciliation
          </ButtonLink>
        }
      >
        {none ? (
          <EmptyState
            title="Nothing is waiting for Stripe"
            description="No unfinished Stripe requests or unapplied billing end dates are currently recorded."
          />
        ) : (
          <p className="text-sm text-ink-soft">
            If an item remains here, use reconciliation to compare Appliance
            Desk records with Stripe before taking any manual action.
          </p>
        )}
      </Card>

      {operations.length > 0 && (
        <Card title={`Requests not confirmed (${operationCount})`}>
          <ul className="divide-y divide-line">
            {operations.map((operation) => (
              <li key={operation.id} className="py-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">
                    {operation.what}
                  </p>
                  <StatusPill
                    tone="pending"
                    label={operation.status}
                  />
                </div>
                <p className="mt-2 text-ink-soft">
                  {operation.meaning}
                </p>
                <p className="mt-2 text-xs text-ink-soft">
                  Asked {formatBusinessDate(operation.since)} ·{" "}
                  {formatBusinessTime(operation.since)} · tried{" "}
                  {operation.attempts} time(s)
                </p>
                {operation.lastError && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Last message from Stripe: {operation.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {endings.length > 0 && (
        <Card
          title={`Billing end dates not applied yet (${endings.length})`}
        >
          <ul className="divide-y divide-line">
            {endings.map((ending) => (
              <li
                key={ending.stripeSubscriptionId}
                className="py-4 text-sm"
              >
                <p className="font-semibold text-ink">{ending.what}</p>
                <p className="mt-2 text-xs text-ink-soft">
                  <Link
                    className="font-medium text-ink underline-offset-4 hover:underline"
                    href={`/desk/agreements/${ending.agreementId}`}
                  >
                    Open the rental
                  </Link>{" "}
                  · waiting since {formatBusinessDate(ending.since)} · tried{" "}
                  {ending.attempts} time(s)
                </p>
                {ending.lastError && (
                  <p className="mt-1 text-xs text-ink-soft">
                    Last message: {ending.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
