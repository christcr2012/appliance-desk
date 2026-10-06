import { EndRental } from "./end-rental";
import { EndFixedTerm } from "./end-fixed-term";
import { AutoRenewControl } from "./auto-renew-control";
import {
  effectiveMonthToMonthTerms,
  getMonthToMonthEndQuote,
  type MonthToMonthTerms,
} from "@/domains/agreements/month-to-month";
import { getEarlyTerminationQuote } from "@/domains/agreements/term";
import { describeSnapshotTerms, snapshotAutoRenew } from "@/domains/agreements/terms-snapshot";
import { addBusinessDays, formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { getServerSession } from "@/lib/session";
import { getPortalData, getPortalJobsPage } from "@/domains/portal";
import { formatCents } from "@/domains/pricing/money";
import { prisma } from "@/lib/prisma";
import {
  rentalAgreementStatusLabel,
  rentalAgreementStatusTone,
  jobStatusLabel,
  jobTypeLabel,
} from "@/lib/status-labels";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatusPill,
} from "@/components/ui";

export const metadata = { title: "My rentals" };

function positivePage(value?: string): number {
  const parsed = Number(value ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
}

function unusedTreatmentLabel(value: "REFUND" | "CREDIT" | "RETAIN"): string {
  if (value === "REFUND") return "refunded";
  if (value === "CREDIT") return "left as account credit";
  return "not refunded";
}

export default async function AccountRentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ visitsPage?: string }>;
}) {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer || !session) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="My rentals" />
        <EmptyState
          title="No rental account found"
          description="Contact the business if you expected to see rental details here."
        />
      </div>
    );
  }

  const visitsPage = positivePage((await searchParams).visitsPage);
  const visitPage = visitsPage === 1
    ? { page: 1, items: customer.jobs, hasMore: customer.jobsHasMore }
    : await getPortalJobsPage(session.user.id, visitsPage);

  const monthToMonthEndQuotes = new Map<string, Awaited<ReturnType<typeof getMonthToMonthEndQuote>>>();
  const monthToMonthTerms = new Map<string, MonthToMonthTerms | null>();
  const earlyEndQuotes = new Map<string, Awaited<ReturnType<typeof getEarlyTerminationQuote>>>();

  await Promise.all(customer.rentalAgreements.map(async (agreement) => {
    if (agreement.termMonths === null) {
      const terms = await prisma.$transaction((tx) => effectiveMonthToMonthTerms(tx, agreement.id, new Date()));
      monthToMonthTerms.set(agreement.id, terms);
      if (agreement.status === "ACTIVE" && !agreement.terminationRequestedAt) {
        monthToMonthEndQuotes.set(agreement.id, await getMonthToMonthEndQuote(agreement.id));
      }
    } else if (
      agreement.status === "ACTIVE" &&
      !agreement.terminationRequestedAt &&
      describeSnapshotTerms(agreement.termsSnapshot).ending
    ) {
      earlyEndQuotes.set(agreement.id, await getEarlyTerminationQuote(agreement.id));
    }
  }));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="My rentals"
        description="Review your rental items, visits, and the ending or renewal terms that belong to each agreement."
        secondaryActions={
          <ButtonLink
            href="/account/maintenance?request=pickup"
            variant="secondary"
          >
            Request pickup
          </ButtonLink>
        }
      />

      {customer.rentalAgreements.length === 0 ? (
        <EmptyState
          title="You don't have any rentals yet"
          description="Signed and active rental details will appear here."
        />
      ) : (
        <div className="space-y-6">
          {customer.rentalAgreements.map((agreement) => {
            const total = agreement.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0);
            const fixedTerms = agreement.termMonths ? describeSnapshotTerms(agreement.termsSnapshot) : null;
            const lockedAutoRenew = agreement.termMonths ? snapshotAutoRenew(agreement.termsSnapshot) : null;
            const mtmTerms = monthToMonthTerms.get(agreement.id) ?? null;
            const mtmQuote = monthToMonthEndQuotes.get(agreement.id) ?? null;
            const earlyQuote = earlyEndQuotes.get(agreement.id) ?? null;
            const nextVisit = agreement.jobs[0] ?? null;
            const endingLastBilledDay = agreement.terminationEffectiveOn
              ? addBusinessDays(agreement.terminationEffectiveOn, -1)
              : null;

            return (
              <Card
                key={agreement.id}
                title={`${agreement.serviceAddress.line1}, ${agreement.serviceAddress.city}`}
                description={
                  agreement.termMonths
                    ? `${agreement.termMonths}-month term`
                    : "Month-to-month"
                }
                actions={
                  <StatusPill
                    tone={rentalAgreementStatusTone(agreement.status)}
                    label={
                      agreement.status === "SCHEDULED" && agreement.startDate
                        ? `Renewal starts on ${formatBusinessDate(agreement.startDate)}`
                        : rentalAgreementStatusLabel(agreement.status)
                    }
                  />
                }
              >

                {agreement.terminationRequestedAt && agreement.terminationEffectiveOn && endingLastBilledDay && (
                  <p className="mt-3 rounded-card border border-line bg-subtle p-3 text-sm text-ink">
                    Ends on {formatBusinessDate(agreement.terminationEffectiveOn)} — last billed day {formatBusinessDate(endingLastBilledDay)}.
                    We will contact you to arrange pickup.
                  </p>
                )}

                <div className="mt-4 rounded-card bg-subtle p-3">
                  <p className="text-sm font-medium text-ink">Next visit</p>
                  {nextVisit?.scheduledAt ? (
                    <p className="mt-1 text-sm text-ink-soft">
                      {jobTypeLabel(nextVisit.type)} · {formatBusinessDate(nextVisit.scheduledAt)} · {formatBusinessTime(nextVisit.scheduledAt)}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-ink-soft">No visit is scheduled for this rental.</p>
                  )}
                </div>

                <h3 className="mt-4 text-sm font-medium text-ink">Items</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                  {agreement.lines.map((line) => (
                    <li key={line.id}>
                      {line.label} — {formatCents(line.monthlyPriceCents)}/month
                      {line.prepayDiscountCentsPerMonth > 0 && (
                        <span className="text-ink-faint">
                          {" "}(list price {formatCents(line.listPriceCents)}, includes a {formatCents(line.prepayDiscountCentsPerMonth)}/month term discount)
                        </span>
                      )}
                      {line.assignments.length > 0 && (
                        <> · {line.assignments.map((assignment) => `${assignment.appliance.applianceType.name} ${assignment.appliance.assetNumber}`).join(", ")}</>
                      )}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-sm font-medium text-ink">Monthly total: {formatCents(total)}</p>
                {agreement.freeMonthGranted && (
                  <p className="text-sm font-medium text-success">Paid in full, in advance — your first month was free.</p>
                )}
                {agreement.depositCents > 0 && (
                  <p className="text-sm text-ink-soft">Deposit required: {formatCents(agreement.depositCents)}</p>
                )}

                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="font-medium text-ink">Ending and renewal terms for this rental</h3>
                  {agreement.termMonths ? (
                    <div className="mt-2 space-y-4 text-sm">
                      <div>
                        <p className="font-medium text-ink">Ending early</p>
                        {fixedTerms?.ending ? (
                          <>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
                              {fixedTerms.ending.lines.map((line) => <li key={line}>{line}</li>)}
                            </ul>
                            <p className="mt-2 whitespace-pre-line text-ink-soft">{fixedTerms.ending.termsText}</p>
                          </>
                        ) : (
                          <p className="mt-1 text-ink-soft">Not available for this rental — contact us.</p>
                        )}
                      </div>

                      {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && fixedTerms?.ending && (
                        earlyQuote ? (
                          <div className="rounded-card border border-line bg-subtle p-3">
                            <p className="font-medium text-ink">Your ending quote</p>
                            <ul className="mt-1 space-y-1 text-ink-soft">
                              <li>Ending date: {formatBusinessDate(earlyQuote.effectiveOn)}</li>
                              <li>Last billed day: {formatBusinessDate(addBusinessDays(earlyQuote.effectiveOn, -1))}</li>
                              <li>Early-ending fee: {formatCents(earlyQuote.feeCents)}</li>
                              <li>Unused prepaid amount: {formatCents(earlyQuote.unusedTermCents)} — {unusedTreatmentLabel(earlyQuote.unusedTermTreatment)}</li>
                              {earlyQuote.unpaidBalanceCents > 0 && <li>Existing unpaid balance: {formatCents(earlyQuote.unpaidBalanceCents)}</li>}
                            </ul>
                            <p className="mt-2 text-ink-soft">
                              The business settles any prepaid refund or credit and arranges pickup. Nothing here automatically charges your card.
                            </p>
                            <EndFixedTerm
                              agreementId={agreement.id}
                              effectiveOn={earlyQuote.effectiveOn.toISOString()}
                              effectiveLabel={formatBusinessDate(earlyQuote.effectiveOn)}
                              remainingTermMonths={earlyQuote.remainingTermMonths}
                              remainingRentCents={earlyQuote.remainingRentCents}
                              feeCents={earlyQuote.feeCents}
                              unusedTermCents={earlyQuote.unusedTermCents}
                              unusedTermTreatment={earlyQuote.unusedTermTreatment}
                              prepaidReviewRequired={earlyQuote.prepaidReviewRequired}
                              unpaidBalanceCents={earlyQuote.unpaidBalanceCents}
                              policyVersion={earlyQuote.policyVersion}
                            />
                          </div>
                        ) : (
                          <p className="text-ink-soft">Ending online is not available right now — contact us.</p>
                        )
                      )}

                      <div>
                        <p className="font-medium text-ink">Automatic renewal</p>
                        {fixedTerms?.autoRenew && lockedAutoRenew ? (
                          <>
                            <p className="mt-1 text-ink-soft">{fixedTerms.autoRenew.noticeLine}</p>
                            <p className="mt-2 whitespace-pre-line text-ink-soft">{fixedTerms.autoRenew.termsText}</p>
                            {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && (
                              <>
                                <p className="mt-2 text-ink-soft">
                                  Current choice: {agreement.renewalPreference === "AUTO_RENEW" ? "automatic renewal is on" : "automatic renewal is off"}.
                                </p>
                                <AutoRenewControl
                                  agreementId={agreement.id}
                                  enabled={agreement.renewalPreference === "AUTO_RENEW"}
                                  termsVersion={lockedAutoRenew.termsVersion}
                                />
                              </>
                            )}
                          </>
                        ) : (
                          <p className="mt-1 text-ink-soft">Not available for this rental — contact us.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm">
                      {mtmTerms ? (
                        <>
                          <p className="text-ink-soft">
                            This rental is month-to-month. The terms that apply to it require {mtmTerms.noticeDays} days&apos; notice to end it, with no ending fee.
                          </p>
                          <p className="mt-2 whitespace-pre-line text-ink-soft">{mtmTerms.termsText}</p>
                        </>
                      ) : (
                        <p className="text-ink-soft">Not available for this rental — contact us.</p>
                      )}
                      {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && mtmQuote && (
                        <div className="mt-3 rounded-card border border-line bg-subtle p-3">
                          <p className="text-ink">
                            If you end it now, it will end on {formatBusinessDate(mtmQuote.effectiveOn)}; your last billed day will be {formatBusinessDate(mtmQuote.lastBilledDay)}. There is no fee. We will arrange pickup.
                          </p>
                          <EndRental
                            agreementId={agreement.id}
                            effectiveOn={mtmQuote.effectiveOn.toISOString()}
                            lastBilledDay={mtmQuote.lastBilledDay.toISOString()}
                            noticeDays={mtmQuote.noticeDays}
                            termsVersion={mtmQuote.termsVersion}
                            effectiveLabel={formatBusinessDate(mtmQuote.effectiveOn)}
                            lastBilledLabel={formatBusinessDate(mtmQuote.lastBilledDay)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ButtonLink
        href="/account/maintenance?request=pickup"
        variant="secondary"
        className="mt-6"
      >
        Request pickup
      </ButtonLink>
      <p className="mt-2 text-sm text-ink-soft">
        A pickup request is reviewed by the business; it does not cancel your agreement or change billing automatically.
      </p>

      <div className="mt-8">
        <h2 className="font-medium text-ink">Delivery &amp; visit history</h2>
        {!visitPage || visitPage.items.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">No visits on this page.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface">
            {visitPage.items.map((job) => (
              <li key={job.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink">{jobTypeLabel(job.type)}</p>
                <p className="text-ink-soft">
                  {jobStatusLabel(job.status)}
                  {job.scheduledAt && ` · ${formatBusinessDate(job.scheduledAt)} · ${formatBusinessTime(job.scheduledAt)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-4 text-sm">
          {visitsPage > 1 && (
            <ButtonLink
              href={`/account/rentals?visitsPage=${visitsPage - 1}`}
              variant="secondary"
            >
              Newer visits
            </ButtonLink>
          )}
          {visitPage?.hasMore && (
            <ButtonLink
              href={`/account/rentals?visitsPage=${visitsPage + 1}`}
              variant="secondary"
            >
              Older visits
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}
