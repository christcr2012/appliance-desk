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

export const metadata = { title: "Growth" };

// OWNER/ADMIN only (docs/DECISIONS.md, 2026-09-28 "Staff permissions
// framework") — never rely on the nav link being hidden alone.
export default async function GrowthPage() {
  await requireRole("OWNER", "ADMIN");
  const [churnRisk, winBackLeads, priceReview, utilizationFlags, reviewCandidates] =
    await Promise.all([
      getChurnRiskCustomers(),
      getWinBackLeads(),
      getPriceReviewAgreements(),
      getUtilizationFlags(),
      getReviewRequestCandidates(),
    ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Growth</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Signals pulled from your existing data — customers worth a
        proactive call, leads worth a second follow-up, agreements that
        haven&apos;t had their price revisited, and fleet numbers worth
        acting on. Nothing here does anything automatically — every item
        is a nudge for you to act on, not an action taken for you.
      </p>

      <section className="mt-8">
        <h2 className="font-medium text-ink">
          Customers worth a proactive call ({churnRisk.length})
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Active rentals showing a churn signal — a past-due invoice, a
          recent failed payment, a term ending soon with no renewal, or
          repeat repair requests.
        </p>
        <MetricHelp metric="growth.churnRisk" />
        {churnRisk.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {churnRisk.map((row) => (
              <li key={row.agreementId}>
                <Link
                  href={`/desk/customers/${row.customerId}`}
                  className="flex flex-col gap-1 px-4 py-4 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="font-medium text-ink">{row.customerName}</p>
                  <p className="text-sm text-amber-700 sm:text-right">
                    {row.reasons.join(" · ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-ink">
          Leads worth a follow-up ({winBackLeads.length})
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Gone quiet, or marked lost long enough ago that it&apos;s worth
          another try.
        </p>
        <MetricHelp metric="growth.winBack" />
        {winBackLeads.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {winBackLeads.map((lead) => (
              <li key={lead.leadId}>
                <Link
                  href={`/desk/leads/${lead.leadId}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm text-ink">
                    {lead.contactName}
                    {lead.companyName ? ` — ${lead.companyName}` : ""}
                  </p>
                  <p className="text-sm text-ink-faint">{lead.reason}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-ink">
          Agreements due for a price review ({priceReview.length})
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Active for a year or more at the same agreed price. A reminder
          only — nothing changes a customer&apos;s price automatically.
        </p>
        <MetricHelp metric="growth.priceReview" />
        {priceReview.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {priceReview.map((row) => (
              <li key={row.agreementId}>
                <Link
                  href={`/desk/agreements/${row.agreementId}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm text-ink">{row.customerName}</p>
                  <p className="text-sm text-ink-faint">
                    Signed {row.monthsAgo} months ago · {formatCents(row.monthlyTotalCents)}/mo
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-ink">
          Fleet flags ({utilizationFlags.length})
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          An appliance type running near-fully-rented is probably costing
          you rentals to no availability; one sitting mostly idle may be
          overpriced or overstocked.
        </p>
        <MetricHelp metric="growth.fleetFlags" />
        {utilizationFlags.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {utilizationFlags.map((row) => (
              <li key={row.applianceTypeId} className="flex items-center justify-between px-4 py-3">
                <p className="text-sm text-ink">
                  {row.applianceTypeName} — {row.unitCount} unit{row.unitCount === 1 ? "" : "s"}
                </p>
                <p
                  className={`text-sm font-medium ${
                    row.flag === "SHORTAGE" ? "text-amber-700" : "text-ink-faint"
                  }`}
                >
                  {Math.round(row.averageUtilizationFraction * 100)}% utilized —{" "}
                  {row.flag === "SHORTAGE" ? "consider buying more" : "consider reviewing price/stock"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-ink">
          Good candidates for a review or referral ask ({reviewCandidates.length})
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Billing cleanly for 90+ days with nothing past due — a
          reasonable moment to ask for a Google review or a referral.
          Nothing is sent automatically; this is just who to reach out to.
        </p>
        {reviewCandidates.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">Nothing flagged right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {reviewCandidates.map((row) => (
              <li key={row.agreementId}>
                <Link
                  href={`/desk/customers/${row.customerId}`}
                  className="block px-4 py-3 text-sm text-ink hover:bg-canvas"
                >
                  {row.customerName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
