import { AgreementProgress } from "@/components/desk/agreement-progress";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAgreement } from "./operational-agreement";
import Link from "next/link";
import { getAgreementById } from "@/domains/agreements";
import { getAppliances } from "@/domains/inventory";
import { AgreementDetailPanel } from "./agreement-detail-panel";
import { MonthToMonthEndForm } from "./month-to-month-end-form";
import { getMonthToMonthEndQuote } from "@/domains/agreements/month-to-month";
import { billingPeriodFor } from "@/lib/business-date";
import { latestArtifactId } from "@/domains/documents/artifacts";
import { listPackagesForLines } from "@/domains/packages";
import { getDraftSigningChargePreview } from "@/domains/billing/signing-charge-preview";
import { formatMoney } from "@/lib/money-ui";
import { getPreparedSigningChargeReview } from "@/domains/billing/signing-charge-review";
import { SigningChargePrepareForm } from "./signing-charge-prepare-form";
import { assessPreparedSigningCharges } from "@/domains/billing/signing-charge-readiness";

export const metadata = { title: "Agreement" };

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAgreement id={id} />;
  const [agreement, availableAppliances, packages] = await Promise.all([
    getAgreementById(id),
    getAppliances({ status: "AVAILABLE" }),
    listPackagesForLines(),
  ]);

  if (!agreement) {
    notFound();
  }

  const [endQuote, signedArtifactId, signingPreview, preparedCharges] = await Promise.all([
    agreement.status === "ACTIVE" && agreement.termMonths === null ? getMonthToMonthEndQuote(agreement.id) : null,
    agreement.signature?.signedAt ? latestArtifactId("SIGNED_AGREEMENT", agreement.id) : null,
    agreement.status === "DRAFT" ? getDraftSigningChargePreview(agreement.id) : null,
    agreement.status === "DRAFT" ? getPreparedSigningChargeReview(agreement.id) : [],
  ]);
  const readiness = preparedCharges.length > 0
    ? assessPreparedSigningCharges(preparedCharges.map((row) => row.agreementId), preparedCharges)
    : null;
  const earlierOptions: Date[] = [];
  if (endQuote && agreement.nextBillingDate) {
    for (let k = 0; k < 600; k += 1) {
      const start = billingPeriodFor(agreement.nextBillingDate, k).start;
      if (start >= endQuote.effectiveOn) break;
      earlierOptions.push(start);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/desk/agreements"
        className="text-sm text-ink-soft hover:underline"
      >
        &larr; Back to agreements
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        Agreement for{" "}
        <Link
          href={`/desk/customers/${agreement.customer.id}`}
          className="hover:underline"
        >
          {agreement.customer.user.name ?? agreement.customer.user.email}
        </Link>
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
        {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
      </p>
      {signedArtifactId && (
        <p className="mt-3 text-sm">
          <Link className="font-medium text-primary underline" href={`/api/documents/${signedArtifactId}`} target="_blank">
            View frozen signed agreement record
          </Link>
          <span className="ml-2 text-ink-soft">This is the exact stored evidence from signing.</span>
        </p>
      )}

      {signingPreview && (
        <section aria-labelledby="signing-preview-heading" className="mt-6 rounded-lg border border-border p-4">
          <h2 id="signing-preview-heading" className="font-semibold">Signing charges — planning preview</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Estimated mandatory signing amounts for this draft order. This is not a bill,
            a payment request, or a signed contract. First month&apos;s rent begins at delivery,
            except that a large-order down payment will credit that first bill.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Administrative setup fees</dt><dd>{formatMoney(signingPreview.setupTotalCents)}</dd></div>
            <div className="flex justify-between"><dt>Large-order down payment</dt><dd>{formatMoney(signingPreview.downPaymentTotalCents)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Before any applicable tax</dt><dd>{formatMoney(signingPreview.amountDueAtSigningCents)}</dd></div>
          </dl>
          <p className="mt-2 text-sm text-ink-soft">
            {signingPreview.locations.length} delivery location(s); {signingPreview.machineCount} machine(s).
            {signingPreview.requiresTaxReview
              ? " Setup-fee tax treatment needs CPA confirmation before this total can be finalized."
              : " Tax and full customer-facing totals will be finalized in the signing workflow."}
          </p>
        </section>
      )}
      {agreement.status === "DRAFT" && (
        <section aria-labelledby="prepared-charges-heading" className="mt-6 rounded-lg border border-border p-4">
          <h2 id="prepared-charges-heading" className="font-semibold">
            Prepare this order for signing
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Save a private version of the draft setup fees and first-month
            down-payment amounts for each rental agreement. You can refresh
            it after changing an unsent draft. This does not send a contract,
            book a delivery, collect money, or issue a first-bill credit.
          </p>
          <SigningChargePrepareForm agreementId={agreement.id} />
          {readiness && (
            <div className="mt-3 rounded-md border border-border p-3" role="status">
              <p className="text-sm font-medium">Pre-signing reconciliation</p>
              <p className="mt-1 text-sm">
                {readiness.amountsReconciled
                  ? "Draft allocations reconcile across this order."
                  : "Draft allocations need correction before they can be finalized."}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {readiness.machineCount} machine(s) · Setup: {formatMoney(readiness.totalSetupCents)} ·
                Down payment: {formatMoney(readiness.totalDownPaymentCents)} ·
                Pre-tax subtotal: {formatMoney(readiness.totalBeforeTaxCents)}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <p className="mt-2 text-sm font-medium">
                Not approved for signing, freezing, charging or sending to customers.
              </p>
            </div>
          )}
          {preparedCharges.length > 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">
                Prepared records — verify every location before any customer-facing quote
              </p>
              {preparedCharges.map((charge) => (
                <div key={charge.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {charge.agreement.serviceAddress.line1},{" "}
                    {charge.agreement.serviceAddress.city},{" "}
                    {charge.agreement.serviceAddress.state}{" "}
                    {charge.agreement.serviceAddress.zip}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {charge.machineCount} machine(s) · Draft revision {charge.version}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt>Setup fee allocated here</dt><dd>{formatMoney(charge.setupFeeCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Down payment for this agreement</dt><dd>{formatMoney(charge.downPaymentCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 font-semibold">
                      <dt>Draft subtotal before tax</dt><dd>{formatMoney(charge.signingSubtotalCents)}</dd>
                    </div>
                  </dl>
                  <p className="mt-1 text-xs text-ink-soft">
                    {charge.setupFeeTaxTreatment === "UNDECIDED"
                      ? "Setup-fee tax treatment awaits CPA confirmation; do not send or charge this total."
                      : "Prepared amounts are not a tax-inclusive final signing total or proof of payment."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              No complete order-wide preparation is on record yet.
            </p>
          )}
        </section>
      )}
      <div className="mt-6">
        <AgreementProgress agreement={agreement} />
      </div>
      <div className="mt-6">
        <AgreementDetailPanel
          agreement={agreement}
          packages={packages}
          availableAppliances={availableAppliances.map((a) => ({
            id: a.id,
            assetNumber: a.assetNumber,
            typeName: a.applianceType.name,
          }))}
        />
      </div>
      {agreement.status === "ACTIVE" && (
        <p className="mt-6 text-sm text-ink-soft">
          Did all of the equipment come back early?{" "}
          <Link href={`/desk/agreements/${agreement.id}/early-return`} className="font-medium text-primary underline">
            Choose what happens to billing, refunds and fees
          </Link>
          .
        </p>
      )}
      {endQuote && (
        <MonthToMonthEndForm
          agreementId={agreement.id}
          noticeDays={endQuote.noticeDays}
          effectiveOn={endQuote.effectiveOn}
          earlierOptions={earlierOptions}
        />
      )}
    </div>
  );
}