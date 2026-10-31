import Link from "next/link";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { EmptyState, ScreenHeader, StatStrip, actionButtonClass } from "@/components/kit";
import { InfoNote } from "@/components/portal/info-note";
import { getServerSession } from "@/lib/session";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel, portalStatement, visitCountLabel, requestCountLabel } from "@/domains/language/portal-copy";
import { getPortalHome } from "@/domains/portal/workspace";
import { isPayNowEligible } from "@/domains/portal/pay-now";
import { getBusinessSettings } from "@/domains/settings";
import { formatCents } from "@/domains/pricing/money";
import {
  businessDateKey,
  formatBusinessDate as originalBusinessDate,
  formatBusinessTime as originalBusinessTime,
  relativeBusinessDay,
} from "@/lib/business-date";
import { jobKindLabel } from "@/lib/status-labels";
import { describeRentalLine } from "@/domains/portal/line-display";
import { OpenVisits } from "@/components/portal/open-visits";
import { PropertyPicker } from "./property-picker";

export const metadata = { title: "My account" };

/** Whole calendar days from one business date key to another. */
function keyDaysBetween(fromKey: string, toKey: string): number {
  const parse = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(toKey) - parse(fromKey)) / 86_400_000);
}

export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string; billing?: string; signingPayment?: string }>;
}) {
  const params = await searchParams;
  const data = await getPortalHome(params.address);
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const formatBusinessDate = (date: Date) => originalBusinessDate(date, locale);
  const formatBusinessTime = (date: Date) => originalBusinessTime(date, locale);
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);

  const settings = await getBusinessSettings();
  const phone =
    settings.publicPhone && !settings.publicPhone.startsWith("[")
      ? settings.publicPhone
      : null;

  if (!data) {
    return (
      <div className="max-w-3xl">
        <h1 className="pb-4 text-xl font-bold text-ink">{t("Welcome")}</h1>
        <EmptyState
          title={t("No rental account is linked to this sign-in")}
          action={phone ? { kind: "tel", label: t("Call us"), phone } : undefined}
        />
      </div>
    );
  }

  const now = new Date();
  const invoice = data.invoice;
  const daysLate =
    invoice?.dueDate && invoice.balanceCents > 0
      ? keyDaysBetween(businessDateKey(invoice.dueDate), businessDateKey(now))
      : 0;
  const dueInDays =
    invoice?.dueDate && invoice.balanceCents > 0
      ? keyDaysBetween(businessDateKey(now), businessDateKey(invoice.dueDate))
      : null;

  // "Needs you": first match wins (PORTAL-1 section 5.1) — a late bill,
  // then a rental waiting for signature, then a bill due within 7 days.
  const needsYou: { title: string; payNow: boolean; link?: { href: string; label: string } } | null =
    invoice && daysLate > 0
      ? {
          title: `${portalStatement(locale, "billLate", { number: invoice.invoiceNumber, days: daysLate })} · ${formatCents(invoice.balanceCents)}`,
          payNow: isPayNowEligible(invoice, now),
          link: { href: `/account/billing/invoice/${invoice.id}`, label: t("Open bill") },
        }
      : data.signingWaiting.length > 0
        ? {
            title: t("Your rental is ready to sign"),
            payNow: false,
            link: { href: data.signingWaiting[0].signHref, label: t("Sign") },
          }
        : invoice && dueInDays !== null && dueInDays >= 0 && dueInDays <= 7
          ? {
              title: portalStatement(locale, "billDueSoon", {
                number: invoice.invoiceNumber,
                when: relativeBusinessDay(invoice.dueDate!, now),
              }),
              payNow: false,
              link: { href: `/account/billing/invoice/${invoice.id}`, label: t("Open bill") },
            }
          : null;

  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const nextVisit = data.nextVisit;

  return (
    <div className="max-w-5xl">
      <PaymentReturnNotice language={locale} state={params.signingPayment ?? params.billing} />
      <ScreenHeader
        title={firstName ? portalStatement(locale, "greeting", { name: firstName }) : t("Your account")}
        primary={{ kind: "link", label: t("Ask for a repair"), href: "/account/maintenance?request=repair" }}
        overflow={[
          { kind: "link", label: t("Ask for a pickup"), href: "/account/maintenance?request=pickup" },
          { kind: "link", label: t("My properties"), href: "/account/properties" },
        ]}
      />

      {data.properties.length > 1 && (
        <PropertyPicker
          label={t("Property")}
          allLabel={t("All properties")}
          addresses={data.properties}
          selectedId={data.addressId}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {needsYou ? (
            <section
              aria-label={t("Needs you")}
              className="rounded-card border border-warning-bg bg-warning-bg/40 px-4 py-3.5"
            >
              <p className="text-xs font-bold text-warning-ink">{t("Needs you")}</p>
              <p className="mt-1 text-base font-bold text-ink">{needsYou.title}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {needsYou.payNow && invoice ? (
                  <form method="post" action={`/account/billing/invoice/${invoice.id}/pay`}>
                    <button type="submit" className={actionButtonClass({ spec: { kind: "link", label: t("Pay now"), href: "#" }, variant: "primary" })}>
                      {t("Pay now")}
                    </button>
                  </form>
                ) : null}
                {needsYou.link ? (
                  <Link
                    href={needsYou.link.href}
                    className={actionButtonClass({ spec: { kind: "link", label: needsYou.link.label, href: needsYou.link.href }, variant: needsYou.payNow ? "secondary" : "primary" })}
                  >
                    {needsYou.link.label}
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          <StatStrip
            items={[
              { label: t("Monthly rent"), value: formatCents(data.monthlyTotalCents) },
              {
                label: t("You owe"),
                value: formatCents(data.balanceCents),
                tone: data.balanceCents > 0 && daysLate > 0 ? "attention" : "neutral",
              },
              {
                label: t("Next visit"),
                value: nextVisit?.scheduledAt
                  ? `${formatBusinessDate(nextVisit.scheduledAt)} · ${formatBusinessTime(nextVisit.scheduledAt)}`
                  : t("None booked"),
              },
            ]}
          />

          <section aria-label={t("Rentals")} className="rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-base font-bold text-ink">{t("Rentals")}</h2>
            {data.rentals.length ? (
              <ul className="mt-3 space-y-3">
                {data.rentals.map((agreement) => (
                  <li key={agreement.id} className="rounded-card border border-line bg-subtle p-4">
                    <Link href={`/account/rentals#rental-${agreement.id}`} className="font-semibold text-ink hover:underline">
                      {agreement.serviceAddress.line1}
                      {agreement.serviceAddress.line2 && `, ${agreement.serviceAddress.line2}`}
                      , {agreement.serviceAddress.city}
                    </Link>
                    <p className="mt-1 text-sm text-ink-soft">
                      {agreement.lines.map((line) => describeRentalLine(line)).join(", ")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {formatCents(agreement.monthlyTotalCents)} {t("per month")}
                    </p>
                    {agreement.outOfServicePeriods.map((away) => (
                      <p key={away.id} className="mt-2 text-sm text-ink">
                        {portalStatement(locale, "repair", { appliance: away.appliance.applianceType.name.toLowerCase(), date: formatBusinessDate(away.startedOn) })}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3">
                <EmptyState title={t("No active rentals")} />
              </div>
            )}
            {data.activeRentalCount > data.rentals.length && (
              <p className="mt-3 text-sm">
                <Link href="/account/rentals" className="font-semibold text-primary hover:underline">
                  {portalStatement(locale, "seeAllRentals", { count: data.activeRentalCount })}
                </Link>
              </p>
            )}
          </section>

          {data.openVisits.length > 0 && <OpenVisits visits={data.openVisits} locale={locale} />}
        </div>

        <div className="min-w-0 space-y-5">
          <section aria-label={t("Next visit")} className="rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 className="text-base font-bold text-ink">{t("Next visit")}</h2>
            <p className="mt-0.5 text-sm text-ink-soft">{visitCountLabel(locale, data.upcomingVisitCount, Boolean(data.addressId))}</p>
            {nextVisit ? (
              <div className="mt-2">
                <p className="font-semibold text-ink">{jobKindLabel(nextVisit, locale)}</p>
                <p className="mt-1 text-ink">
                  {formatBusinessDate(nextVisit.scheduledAt!)} · {formatBusinessTime(nextVisit.scheduledAt!)}
                </p>
                {nextVisit.scheduledAt! < now && (
                  <p className="mt-2 text-sm text-ink-soft">{t("This is the recorded visit time. Contact the business if you need an updated arrival time.")}</p>
                )}
                {nextVisit.serviceAddress && (
                  <p className="mt-2 text-sm text-ink-soft">
                    {nextVisit.serviceAddress.line1}
                    {nextVisit.serviceAddress.line2 && `, ${nextVisit.serviceAddress.line2}`}
                    , {nextVisit.serviceAddress.city}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                {data.upcomingVisitCount
                  ? t("A visit is being arranged; a date has not been set yet.")
                  : t("New visit details will appear once the business schedules them.")}
              </p>
            )}
          </section>

          <section aria-labelledby="portal-help-heading" className="rounded-card bg-primary p-6 text-on-primary dark:border-2 dark:border-primary dark:bg-surface dark:text-ink">
            <h2 id="portal-help-heading" className="text-h3">{t("Need help?")}</h2>
            <p className="mt-1 text-sm opacity-90">{requestCountLabel(locale, data.openRequestCount)}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                href="/account/maintenance?request=repair"
                className="signature-lift cut-corner-sm inline-flex min-h-11 items-center justify-center bg-accent px-5 py-2 text-sm font-semibold text-on-accent"
              >
                {t("Ask for a repair")}
              </Link>
              <Link
                href="/account/maintenance?request=pickup"
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong px-4 py-2 text-sm font-semibold"
              >
                {t("Ask for a pickup")}
              </Link>
              {phone ? (
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline">
                  {t("Call us")} {phone}
                </a>
              ) : null}
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-sm opacity-90">
              <span>{t("Requests are reviewed by the business.")}</span>
              <InfoNote
                label={t("Need help?")}
                text={t("A pickup request doesn't end your rental or change your bills by itself — we'll confirm with you.")}
              />
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
