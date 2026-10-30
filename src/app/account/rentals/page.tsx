import Link from "next/link";
import { CustomerLegalText } from "@/components/customer-legal-text";
import { ScreenHeader, StatStrip, StatusPill, EmptyState, Timeline, type TimelineItem, type Tone } from "@/components/kit";
import { agreementLanguage, agreementLegalTexts } from "@/domains/language/legal";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel, portalStatement } from "@/domains/language/portal-copy";
import { EndRental } from "./end-rental";
import { EndFixedTerm } from "./end-fixed-term";
import { AutoRenewControl } from "./auto-renew-control";
import { SheetToggle } from "./sheet-toggle";
import {
  effectiveMonthToMonthTerms,
  getMonthToMonthEndQuote,
  type MonthToMonthTerms,
} from "@/domains/agreements/month-to-month";
import { getEarlyTerminationQuote } from "@/domains/agreements/term";
import { describeSnapshotTerms, snapshotAutoRenew } from "@/domains/agreements/terms-snapshot";
import { addBusinessDays, formatBusinessDate as originalBusinessDate, formatBusinessTime as originalBusinessTime, formatShortDate } from "@/lib/business-date";
import { getServerSession } from "@/lib/session";
import { getPortalData, getPortalJobsPage } from "@/domains/portal";
import { formatCents } from "@/domains/pricing/money";
import { SigningPaymentSummary } from "@/components/billing/signing-payment-summary";
import { prisma } from "@/lib/prisma";
import { describeRentalLine } from "@/domains/portal/line-display";
import {
  rentalAgreementStatusLabel,
  rentalAgreementStatusTone,
  jobStatusLabel,
  jobKindLabel,
} from "@/lib/status-labels";

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

/** The legacy status tones mapped onto kit tones for the record pill. */
function pillTone(status: string): Tone {
  const tone = rentalAgreementStatusTone(status);
  return tone === "success" ? "good" : tone === "progress" ? "info" : "neutral";
}

function jobTone(status: string): Tone {
  if (status === "COMPLETED") return "good";
  if (status === "IN_PROGRESS") return "attention";
  if (status === "SCHEDULED") return "info";
  if (status === "CANCELLED") return "danger";
  return "neutral";
}

export default async function AccountRentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ visitsPage?: string }>;
}) {
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const formatBusinessDate = (date: Date) => originalBusinessDate(date, locale);
  const formatBusinessTime = (date: Date) => originalBusinessTime(date, locale);
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer || !session) {
    return (
      <div className="max-w-3xl">
        <h1 className="pb-4 text-xl font-bold text-ink">{t("My rentals")}</h1>
        <EmptyState title={t("No rental account found")} />
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

  const legalReadbacks = new Map(await Promise.all(customer.rentalAgreements.map(async (agreement) => {
    const texts = agreement.termMonths === null
      ? [monthToMonthTerms.get(agreement.id)?.termsText ?? ""].filter(Boolean)
      : agreementLegalTexts(agreement.termsSnapshot);
    return [agreement.id, await agreementLanguage(locale, texts)] as const;
  })));

  const visitItems: TimelineItem[] = (visitPage?.items ?? []).map((job) => ({
    id: job.id,
    at: job.scheduledAt ?? job.performedOn ?? new Date(0),
    title: jobKindLabel(job, locale),
    detail: jobStatusLabel(job.status, locale),
    tone: jobTone(job.status),
    actor: job.serviceAddress ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}` : "",
  }));

  return (
    <div className="max-w-4xl">
      <ScreenHeader
        title={t("Rentals")}
        primary={{ kind: "link", label: t("Ask for a pickup"), href: "/account/maintenance?request=pickup" }}
      />

      {customer.rentalAgreements.length === 0 ? (
        <EmptyState title={t("You don't have any rentals yet")} />
      ) : (
        <div className="space-y-6">
          {customer.rentalAgreements.map((agreement) => {
            const legalReadback = legalReadbacks.get(agreement.id)!;
            const total = agreement.monthlyTotalCents;
            const fixedTerms = agreement.termMonths ? describeSnapshotTerms(agreement.termsSnapshot, locale) : null;
            const lockedAutoRenew = agreement.termMonths ? snapshotAutoRenew(agreement.termsSnapshot) : null;
            const mtmTerms = monthToMonthTerms.get(agreement.id) ?? null;
            const mtmQuote = monthToMonthEndQuotes.get(agreement.id) ?? null;
            const earlyQuote = earlyEndQuotes.get(agreement.id) ?? null;
            const nextVisit = agreement.jobs[0] ?? null;
            const endingLastBilledDay = agreement.terminationEffectiveOn
              ? addBusinessDays(agreement.terminationEffectiveOn, -1)
              : null;
            const ending = Boolean(agreement.terminationRequestedAt && agreement.terminationEffectiveOn);
            const pill = ending
              ? { label: portalStatement(locale, "endingOn", { date: formatShortDate(agreement.terminationEffectiveOn!) }), tone: "attention" as Tone }
              : agreement.status === "SCHEDULED" && agreement.startDate
                ? { label: `${t("Renewal starts on")} ${formatBusinessDate(agreement.startDate)}`, tone: "info" as Tone }
                : { label: rentalAgreementStatusLabel(agreement.status, locale), tone: pillTone(agreement.status) };

            return (
              <article
                key={agreement.id}
                id={`rental-${agreement.id}`}
                className="rounded-card border border-line bg-surface p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-ink">
                      {agreement.serviceAddress.line1}, {agreement.serviceAddress.city}
                    </h2>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {agreement.termMonths
                        ? portalStatement(locale, "term", { months: agreement.termMonths })
                        : t("Month-to-month")}
                    </p>
                  </div>
                  <StatusPill label={pill.label} tone={pill.tone} />
                </div>

                <div className="mt-4">
                  <StatStrip
                    items={[
                      { label: t("Monthly total"), value: formatCents(total) },
                      { label: t("Started"), value: agreement.startDate ? formatShortDate(agreement.startDate) : "—" },
                      {
                        label: t("Next visit"),
                        value: nextVisit?.scheduledAt
                          ? `${formatBusinessDate(nextVisit.scheduledAt)} · ${formatBusinessTime(nextVisit.scheduledAt)}`
                          : nextVisit
                            ? t("Not scheduled yet")
                            : t("None booked"),
                      },
                    ]}
                  />
                </div>

                {agreement.terminationRequestedAt && agreement.terminationEffectiveOn && endingLastBilledDay && (
                  <p className="mt-3 rounded-card border border-line bg-subtle p-3 text-sm text-ink">
                    {t("Ends on")} {formatBusinessDate(agreement.terminationEffectiveOn)} — {t("Last billed day")} {formatBusinessDate(endingLastBilledDay)}. {t("We will contact you to arrange pickup.")}
                    <span className="mt-2 block text-ink-soft">{t("Your request to end the rental was recorded. We will arrange pickup and confirm the final day. The final bill is shown in Billing.")}</span>
                  </p>
                )}

                {nextVisit?.type === "DELIVERY" && nextVisit.customerPickupHandoff ? (
                  <p className="mt-3 text-sm text-ink-soft">{t("You're picking this rental up. We'll contact you to arrange when to collect it; the rental starts the day you collect it.")}</p>
                ) : nextVisit?.type === "DELIVERY" && !nextVisit.scheduledAt ? (
                  <p className="mt-3 text-sm text-ink-soft">{t("Delivery is being arranged. The business has not confirmed a date or time yet. This is a request in progress, not a booked appointment.")}</p>
                ) : !nextVisit ? (
                  <p className="mt-3 text-sm text-ink-soft">{t("No visit is scheduled for this rental.")}</p>
                ) : null}

                <h3 className="mt-4 text-sm font-medium text-ink">{t("Items")}</h3>
                <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                  {agreement.lines.map((line) => (
                    <li key={line.id}>
                      {describeRentalLine(line)} — {formatCents(line.monthlyPriceCents)} {t("per month")}
                      {line.prepayDiscountCentsPerMonth > 0 && (
                        <span className="text-ink-faint">
                          {" "}({t("list price")} {formatCents(line.listPriceCents)}, {t("includes a")} {formatCents(line.prepayDiscountCentsPerMonth)} {t("per month")} {t("term discount")})
                        </span>
                      )}
                      {!line.packageId && line.assignments.length > 0 && (
                        <> · {line.assignments.map((assignment) => `${assignment.appliance.applianceType.name} ${assignment.appliance.assetNumber}`).join(", ")}</>
                      )}
                    </li>
                  ))}
                </ul>

                <SigningPaymentSummary language={locale} summary={agreement.signingPaymentSummary ?? null} />
                {agreement.freeMonthGranted && (
                  <p className="text-sm font-medium text-success">{t("Paid in full, in advance — your first month was free.")}</p>
                )}
                {agreement.depositCents > 0 && (
                  <p className="text-sm text-ink-soft">{t("Deposit required")}: {formatCents(agreement.depositCents)}</p>
                )}

                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="font-medium text-ink">{t("Ending or renewing")}</h3>
                  {locale === "es" && <p className="mt-2 text-sm">{t("The recorded English terms below control this rental agreement.")}</p>}
                  {agreement.termMonths ? (
                    <div className="mt-2 space-y-4 text-sm">
                      <div>
                        <p className="font-medium text-ink">{t("Ending early")}</p>
                        {fixedTerms?.ending ? (
                          <>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
                              {fixedTerms.ending.lines.map((line) => <li key={line}>{line}</li>)}
                            </ul>
                            <CustomerLegalText language={legalReadback.language} english={fixedTerms.ending.termsText} spanish={legalReadback.translations.find((row) => row.english === fixedTerms.ending!.termsText)?.spanish} />
                          </>
                        ) : (
                          <p className="mt-1 text-ink-soft">{t("Not available for this rental — contact us.")}</p>
                        )}
                      </div>

                      {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && fixedTerms?.ending && (
                        earlyQuote ? (
                          <SheetToggle buttonLabel={t("End this rental")} title={t("End this rental")}>
                            <div className="rounded-card border border-line bg-subtle p-3">
                              <p className="font-medium text-ink">{t("Your ending quote")}</p>
                              <ul className="mt-1 space-y-1 text-ink-soft">
                                <li>{t("Ending date")}: {formatBusinessDate(earlyQuote.effectiveOn)}</li>
                                <li>{t("Last billed day")}: {formatBusinessDate(addBusinessDays(earlyQuote.effectiveOn, -1))}</li>
                                <li>{t("Early-ending fee")}: {formatCents(earlyQuote.feeCents)}</li>
                                <li>{t("Unused prepaid amount")}: {formatCents(earlyQuote.unusedTermCents)} — {t(unusedTreatmentLabel(earlyQuote.unusedTermTreatment) as "refunded" | "left as account credit" | "not refunded")}</li>
                                {earlyQuote.unpaidBalanceCents > 0 && <li>{t("Existing unpaid balance")}: {formatCents(earlyQuote.unpaidBalanceCents)}</li>}
                              </ul>
                              <p className="mt-2 text-ink-soft">{t("The business settles any prepaid refund or credit and arranges pickup. Nothing here automatically charges your card.")}</p>
                              <div className="mt-3">
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
                            </div>
                          </SheetToggle>
                        ) : (
                          <p className="text-ink-soft">{t("Ending online is not available right now — contact us.")}</p>
                        )
                      )}

                      <div>
                        <p className="font-medium text-ink">{t("Automatic renewal")}</p>
                        {fixedTerms?.autoRenew && lockedAutoRenew ? (
                          <>
                            <p className="mt-1 text-ink-soft">{fixedTerms.autoRenew.noticeLine}</p>
                            <CustomerLegalText language={legalReadback.language} english={fixedTerms.autoRenew.termsText} spanish={legalReadback.translations.find((row) => row.english === fixedTerms.autoRenew!.termsText)?.spanish} />
                            {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && (
                              <div className="mt-3">
                                <SheetToggle buttonLabel={t("Automatic renewal")} title={t("Automatic renewal")}>
                                  <p className="text-ink-soft">
                                    {t("Current choice")}: {t(agreement.renewalPreference === "AUTO_RENEW" ? "automatic renewal is on" : "automatic renewal is off")}.
                                  </p>
                                  <div className="mt-3">
                                    <AutoRenewControl
                                      agreementId={agreement.id}
                                      enabled={agreement.renewalPreference === "AUTO_RENEW"}
                                      termsVersion={lockedAutoRenew.termsVersion}
                                    />
                                  </div>
                                </SheetToggle>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="mt-1 text-ink-soft">{t("Not available for this rental — contact us.")}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm">
                      {mtmTerms ? (
                        <>
                          <p className="text-ink-soft">
                            {portalStatement(locale, "mtm", { days: mtmTerms.noticeDays })}
                          </p>
                          <CustomerLegalText language={legalReadback.language} english={mtmTerms.termsText} spanish={legalReadback.translations.find((row) => row.english === mtmTerms.termsText)?.spanish} />
                        </>
                      ) : (
                        <p className="text-ink-soft">{t("Not available for this rental — contact us.")}</p>
                      )}
                      {agreement.status === "ACTIVE" && !agreement.terminationRequestedAt && mtmQuote && (
                        <div className="mt-3">
                          <SheetToggle buttonLabel={t("End this rental")} title={t("End this rental")}>
                            <div className="rounded-card border border-line bg-subtle p-3">
                              <p className="text-ink">
                                {portalStatement(locale, "mtmEnd", { end: formatBusinessDate(mtmQuote.effectiveOn), last: formatBusinessDate(mtmQuote.lastBilledDay) })}
                              </p>
                              <div className="mt-3">
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
                            </div>
                          </SheetToggle>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-medium text-ink">{t("Visit history")}</h2>
        <div className="mt-2 rounded-card border border-line bg-surface px-4 py-2">
          <Timeline items={visitItems} emptyLabel={t("No visits on this page.")} />
        </div>
        <div className="mt-3 flex gap-4 text-sm">
          {visitsPage > 1 && (
            <Link
              href={`/account/rentals?visitsPage=${visitsPage - 1}`}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 font-semibold text-ink hover:bg-tint"
            >{t("Newer visits")}</Link>
          )}
          {visitPage?.hasMore && (
            <Link
              href={`/account/rentals?visitsPage=${visitsPage + 1}`}
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 font-semibold text-ink hover:bg-tint"
            >{t("Older visits")}</Link>
          )}
        </div>
      </div>
    </div>
  );
}
