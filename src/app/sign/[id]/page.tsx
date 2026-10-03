import { getSignatureRecordForSigning } from "@/domains/agreements";
import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";
import { formatCents } from "@/domains/pricing";
import { SignForm } from "./sign-form";

export const metadata = {
  title: "Sign your rental agreement",
  robots: { index: false, follow: false },
};

export default async function SignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const signature = await getSignatureRecordForSigning(id);

  if (!signature) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
        <p className="mt-3 text-gray-600">
          This agreement may already be signed, or the link may no longer be
          valid. If you think this is a mistake, contact us directly.
        </p>
      </main>
    );
  }

  const { agreement } = signature;
  const lockedTerms = agreement.termMonths
    ? describeSnapshotTerms(agreement.termsSnapshot)
    : { ending: null, autoRenew: null };
  const monthlyTotal = agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold">Review &amp; sign your rental agreement</h1>
      <p className="mt-2 text-sm text-gray-600">
        Prepared for {agreement.customer.user.name ?? agreement.customer.user.email}
      </p>

      <div className="mt-6 space-y-3 rounded-lg border border-gray-200 bg-white p-5 text-sm">
        <p>
          <span className="font-medium">Service address:</span>{" "}
          {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
          {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
        </p>
        <p>
          <span className="font-medium">Term:</span>{" "}
          {agreement.termMonths ? `${agreement.termMonths} months` : "Month-to-month"}
        </p>
        <div>
          <span className="font-medium">Appliances:</span>
          <ul className="mt-1 list-inside list-disc">
            {agreement.lines.map((l) => (
              <li key={l.id}>
                {l.label} — {formatCents(l.monthlyPriceCents)}/month
                {l.prepayDiscountCentsPerMonth > 0 && (
                  <span className="text-gray-600">
                    {" "}
                    (list price {formatCents(l.listPriceCents)}/month, less a{" "}
                    {formatCents(l.prepayDiscountCentsPerMonth)}/month term discount)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-medium">Total: {formatCents(monthlyTotal)}/month</p>
        {agreement.freeMonthGranted && (
          <p className="font-medium text-green-700">
            Paid in full, in advance — your first month is free.
          </p>
        )}
        {agreement.depositCents > 0 && (
          <p>Deposit: {formatCents(agreement.depositCents)}</p>
        )}
        {agreement.damageWaiverCents > 0 && (
          <p>Damage waiver: {formatCents(agreement.damageWaiverCents)} once at signing</p>
        )}
        {(agreement.lateFeeCents > 0 || agreement.lateFeePercent > 0) && (
          <p>
            Late fee after {agreement.lateFeeGraceDays} days:{" "}
            {agreement.lateFeeCents > 0 && formatCents(agreement.lateFeeCents)}
            {agreement.lateFeeCents > 0 && agreement.lateFeePercent > 0 && " or "}
            {agreement.lateFeePercent > 0 && `${agreement.lateFeePercent}%`}
          </p>
        )}
      </div>

      {lockedTerms.ending && (
        <section
          aria-labelledby="ending-terms-heading"
          className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-5 text-sm"
        >
          <h2 id="ending-terms-heading" className="font-medium">
            Ending this agreement early
          </h2>
          <ul className="list-inside list-disc">
            {lockedTerms.ending.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="whitespace-pre-line text-gray-700">{lockedTerms.ending.termsText}</p>
        </section>
      )}

      {lockedTerms.autoRenew && (
        <section
          aria-labelledby="renew-terms-heading"
          className="mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-5 text-sm"
        >
          <h2 id="renew-terms-heading" className="font-medium">
            Automatic renewal
          </h2>
          <p>{lockedTerms.autoRenew.noticeLine}</p>
          <p className="whitespace-pre-line text-gray-700">{lockedTerms.autoRenew.termsText}</p>
        </section>
      )}

      <div className="mt-6">
        <SignForm signatureRecordId={signature.id} />
      </div>
    </main>
  );
}
