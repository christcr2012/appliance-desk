import Link from "next/link";
import {
  getChurnRiskCustomers,
  getPriceReviewAgreements,
  getReviewRequestCandidates,
  getUtilizationFlags,
  getWinBackLeads,
} from "@/domains/growth";
import { formatCents } from "@/domains/pricing";
import { requireRole } from "@/lib/session";
import { MetricHelp } from "@/components/desk/metric-stat";
import { getDemandEstimate } from "@/domains/growth/demand";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Growth" };

export default async function GrowthPage() {
  await requireRole("OWNER", "ADMIN");
  const [
    churnRisk,
    winBackLeads,
    priceReview,
    utilizationFlags,
    reviewCandidates,
    demandEstimate,
  ] = await Promise.all([
    getChurnRiskCustomers(),
    getWinBackLeads(),
    getPriceReviewAgreements(),
    getUtilizationFlags(),
    getReviewRequestCandidates(),
    getDemandEstimate(),
  ]);

  return (
    <div>
      <PageHeader
        title="Growth"
        description="Signals pulled from existing data: customers worth a proactive call, leads worth another follow-up, agreements due for a price review, and fleet numbers worth acting on."
      />

      <p className="max-w-2xl text-sm text-ink-soft">
        Nothing on this page acts automatically. Every item is a nudge for you
        to review and decide what to do.
      </p>

      <div className="mt-8 space-y-6">
        <Card
          title={`Customers worth a proactive call (${churnRisk.length})`}
          description="Active rentals showing a churn signal: a past-due invoice, recent failed payment, a term ending soon with no renewal, or repeat repair requests."
        >
          <MetricHelp metric="growth.churnRisk" />
          {churnRisk.length === 0 ? (
            <EmptyState
              title="Nothing flagged right now"
              description="No active rental currently meets the churn-risk rules."
            />
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {churnRisk.map((row) => (
                <li key={row.agreementId}>
                  <Link
                    href={`/desk/customers/${row.customerId}`}
                    className="flex flex-col gap-1 py-4 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-3"
                  >
                    <p className="font-semibold text-ink">
                      {row.customerName}
                    </p>
                    <p className="text-sm font-medium text-warning-ink sm:text-right">
                      {row.reasons.join(" · ")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Leads worth a follow-up (${winBackLeads.length})`}
          description="Leads that have gone quiet, or were marked lost long enough ago that another try may be worthwhile."
        >
          <MetricHelp metric="growth.winBack" />
          {winBackLeads.length === 0 ? (
            <EmptyState
              title="Nothing flagged right now"
              description="No lead currently meets the win-back rules."
            />
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {winBackLeads.map((lead) => (
                <li key={lead.leadId}>
                  <Link
                    href={`/desk/leads/${lead.leadId}`}
                    className="flex flex-col gap-1 py-4 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-3"
                  >
                    <p className="font-semibold text-ink">
                      {lead.contactName}
                      {lead.companyName ? ` — ${lead.companyName}` : ""}
                    </p>
                    <p className="text-sm text-ink-soft">{lead.reason}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Agreements due for a price review (${priceReview.length})`}
          description="Active for a year or more at the same agreed price. This is a reminder only; no customer price changes automatically."
        >
          <MetricHelp metric="growth.priceReview" />
          {priceReview.length === 0 ? (
            <EmptyState
              title="Nothing flagged right now"
              description="No active agreement currently meets the price-review rule."
            />
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {priceReview.map((row) => (
                <li key={row.agreementId}>
                  <Link
                    href={`/desk/agreements/${row.agreementId}`}
                    className="flex flex-col gap-1 py-4 hover:bg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-3"
                  >
                    <p className="font-semibold text-ink">
                      {row.customerName}
                    </p>
                    <p className="text-sm text-ink-soft">
                      Signed {row.monthsAgo} months ago ·{" "}
                      {formatCents(row.monthlyTotalCents)}/mo
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Estimated demand by appliance type (${demandEstimate.length})`}
          description="Planning estimate only: open NEW/CONTACTED lead requests compared with fleet units not currently in customer custody. It is not a sales forecast or purchase instruction."
        >
          {demandEstimate.length === 0 ? (
            <EmptyState
              title="No open lead demand to estimate"
              description="Demand estimates will appear when open lead requests can be compared with fleet availability."
            />
          ) : (
            <ul className="divide-y divide-line">
              {demandEstimate.map((row) => (
                <li key={row.applianceTypeId} className="py-4 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="font-semibold text-ink">
                      {row.applianceTypeName}
                    </p>
                    <p className="text-ink-soft">
                      Estimated gap: {row.estimatedUnitGap} unit
                      {row.estimatedUnitGap === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    Open lead requests: {row.openLeadRequestedUnits} · Fleet:{" "}
                    {row.fleetUnits} · In customer custody:{" "}
                    {row.unitsInCustomerCustody} · Estimated available now:{" "}
                    {row.availableUnitsEstimate}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Fleet flags (${utilizationFlags.length})`}
          description="High utilization can indicate lost rentals from low availability; persistent low utilization can justify reviewing price or stock."
        >
          <MetricHelp metric="growth.fleetFlags" />
          {utilizationFlags.length === 0 ? (
            <EmptyState
              title="Nothing flagged right now"
              description="No appliance type currently meets the fleet-flag rules."
            />
          ) : (
            <ul className="divide-y divide-line">
              {utilizationFlags.map((row) => (
                <li
                  key={row.applianceTypeId}
                  className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm font-semibold text-ink">
                    {row.applianceTypeName} — {row.unitCount} unit
                    {row.unitCount === 1 ? "" : "s"}
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      row.flag === "SHORTAGE"
                        ? "text-warning-ink"
                        : "text-ink-soft"
                    }`}
                  >
                    {Math.round(row.averageUtilizationFraction * 100)}% utilized
                    {" — "}
                    {row.flag === "SHORTAGE"
                      ? "consider buying more"
                      : "consider reviewing price/stock"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Good candidates for a review or referral ask (${reviewCandidates.length})`}
          description="Billing cleanly for 90+ days with nothing past due. Nothing is sent automatically; this is only a list of customers worth considering."
        >
          {reviewCandidates.length === 0 ? (
            <EmptyState
              title="Nothing flagged right now"
              description="No customer currently meets the review/referral candidate rules."
            />
          ) : (
            <ul className="divide-y divide-line">
              {reviewCandidates.map((row) => (
                <li key={row.agreementId}>
                  <Link
                    href={`/desk/customers/${row.customerId}`}
                    className="block py-4 font-semibold text-ink underline-offset-4 hover:bg-subtle hover:underline sm:px-3"
                  >
                    {row.customerName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
