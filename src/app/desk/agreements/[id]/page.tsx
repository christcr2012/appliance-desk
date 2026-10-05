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

export const metadata = { title: "Agreement" };

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAgreement id={id} />;
  const [agreement, availableAppliances] = await Promise.all([
    getAgreementById(id),
    getAppliances({ status: "AVAILABLE" }),
  ]);

  if (!agreement) {
    notFound();
  }

  const [endQuote, signedArtifactId] = await Promise.all([
    agreement.status === "ACTIVE" && agreement.termMonths === null ? getMonthToMonthEndQuote(agreement.id) : null,
    agreement.signature?.signedAt ? latestArtifactId("SIGNED_AGREEMENT", agreement.id) : null,
  ]);
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

      <div className="mt-6">
        <AgreementProgress agreement={agreement} />
      </div>
      <div className="mt-6">
        <AgreementDetailPanel
          agreement={agreement}
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