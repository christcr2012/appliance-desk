import { getEstimateForApproval } from "@/domains/estimates";
import { formatCents } from "@/domains/pricing";
import { EstimateResponseForm } from "./estimate-response-form";
import { PayDepositButton } from "./pay-deposit-button";

export const metadata = {
  title: "Your estimate",
  robots: { index: false, follow: false },
};

const RESPONDED_STATUSES = new Set(["APPROVED", "CHANGES_REQUESTED", "DECLINED", "EXPIRED", "CONVERTED"]);

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimateForApproval(id);

  if (!estimate) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
        <p className="mt-3 text-gray-600">
          This estimate may not have been sent yet, or the link may no
          longer be valid. If you think this is a mistake, contact us
          directly.
        </p>
      </main>
    );
  }

  const monthly = estimate.lineItems.reduce((sum, l) => sum + l.monthlyPriceCents * l.quantity, 0);
  const oneTime = estimate.lineItems.reduce((sum, l) => sum + l.oneTimeFeeCents * l.quantity, 0);
  const customerName = estimate.customer
    ? (estimate.customer.user.name ?? estimate.customer.user.email)
    : estimate.lead?.contactName;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold">Estimate #{estimate.estimateNumber}</h1>
      <p className="mt-2 text-sm text-gray-600">Prepared for {customerName}</p>

      {estimate.clientMessage && (
        <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{estimate.clientMessage}</p>
      )}

      <div className="mt-6 space-y-3 rounded-lg border border-gray-200 bg-white p-5 text-sm">
        <ul className="divide-y divide-gray-100">
          {estimate.lineItems.map((line) => (
            <li key={line.id} className="py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-gray-900">
                    {line.quantity > 1 ? `${line.quantity}× ` : ""}
                    {line.description}
                  </p>
                  {line.serviceAddress && (
                    <p className="text-xs text-gray-500">
                      {line.serviceAddress.line1}, {line.serviceAddress.city}
                    </p>
                  )}
                </div>
                <div className="text-right text-gray-600">
                  {line.monthlyPriceCents > 0 && <p>{formatCents(line.monthlyPriceCents)}/mo</p>}
                  {line.oneTimeFeeCents > 0 && <p>{formatCents(line.oneTimeFeeCents)} one-time</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-gray-200 pt-3 font-medium text-gray-900">
          {monthly > 0 && <p>{formatCents(monthly)}/month</p>}
          {oneTime > 0 && <p>{formatCents(oneTime)} one-time</p>}
        </div>
        {estimate.depositCents > 0 && <p>Deposit: {formatCents(estimate.depositCents)}</p>}
        {estimate.validUntil && (
          <p className="text-xs text-gray-500">
            Valid until {new Date(estimate.validUntil).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="mt-6">
        {estimate.status === "APPROVED" && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
            <p className="font-medium">You approved this estimate.</p>
            {estimate.depositCents > 0 && estimate.depositPaidAt && (
              <p className="mt-1">
                Deposit of {formatCents(estimate.depositCents)} received — thank you.
              </p>
            )}
            {estimate.depositCents > 0 && !estimate.depositPaidAt ? (
              <>
                <p className="mt-1">
                  One more step: a deposit of {formatCents(estimate.depositCents)} is due before
                  we can move forward.
                </p>
                <PayDepositButton estimateId={estimate.id} />
              </>
            ) : (
              <p className="mt-1">We&apos;ll be in touch about next steps.</p>
            )}
          </div>
        )}
        {estimate.status === "CHANGES_REQUESTED" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">We got your request for changes.</p>
            <p className="mt-1">We&apos;ll follow up with a revised estimate.</p>
          </div>
        )}
        {estimate.status === "DECLINED" && (
          <p className="text-sm text-gray-600">This estimate was declined.</p>
        )}
        {estimate.status === "EXPIRED" && (
          <p className="text-sm text-gray-600">
            This estimate has expired — contact us if you&apos;d still like to move forward.
          </p>
        )}
        {estimate.status === "CONVERTED" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-medium">This estimate was approved and is being set up.</p>
          </div>
        )}
        {!RESPONDED_STATUSES.has(estimate.status) && <EstimateResponseForm estimateId={estimate.id} />}
      </div>
    </main>
  );
}
