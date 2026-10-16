import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { getServerSession } from "@/lib/session";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel, rentalCountLabel, portalStatement, visitCountLabel, requestCountLabel } from "@/domains/language/portal-copy";
import { getPortalHome } from "@/domains/portal/workspace";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate as originalBusinessDate, formatBusinessTime as originalBusinessTime } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { FilterBar } from "@/components/desk/workspace";

export const metadata = { title: "My account" };

export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string; billing?: string; signingPayment?: string }>;
}) {
  const params = await searchParams;
  const data = await getPortalHome(params.address);
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const formatBusinessDate=(date:Date)=>originalBusinessDate(date,locale);
  const formatBusinessTime=(date:Date)=>originalBusinessTime(date,locale);
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);

  if (!data) {
    return (
      <div className="max-w-3xl">
        <PageHeader title={t("Welcome")} />
        <EmptyState
          title={t("No rental account attached to this login")}
          description={t("Contact the business if you expected to see an active rental.")}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PaymentReturnNotice language={locale} state={params.signingPayment ?? params.billing} />
      <PageHeader
        title={t("Your rental account")}
        description={t("Your rentals, next visit, billing and help in one place.")}
        primaryAction={{
          href: "/account/maintenance",
          label: t("Report a problem"),
        }}
        secondaryActions={
          <ButtonLink
            href="/account/maintenance?request=pickup"
            variant="secondary"
          >
            {t("Request pickup")}
          </ButtonLink>
        }
      />

      {data.properties.length > 1 && (
        <FilterBar
          label={t("Account properties")}
          items={[
            {
              href: "/account",
              label: t("All properties"),
              active: !data.addressId,
            },
            ...data.properties.map((address) => ({
              href: `/account?address=${encodeURIComponent(address.id)}`,
              label: `${address.line1}${
                address.line2 ? `, ${address.line2}` : ""
              }`,
              active: address.id === data.addressId,
            })),
          ]}
        />
      )}

      <p className="mb-5"><ButtonLink href="/account/properties" variant="secondary">{t("Manage my properties and on-site contacts")}</ButtonLink></p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={t("What do I rent?")}
          description={rentalCountLabel(locale,data.activeRentalCount,Boolean(data.addressId))}
          actions={
            <ButtonLink href="/account/rentals" variant="secondary">
              {t("View rentals")}
            </ButtonLink>
          }
        >
          {data.rentals.length ? (
            <ul className="space-y-4">
              {data.rentals.map((agreement) => (
                <li
                  key={agreement.id}
                  className="rounded-card border border-line bg-subtle p-4"
                >
                  <p className="font-semibold text-ink">
                    {agreement.serviceAddress.line1}
                    {agreement.serviceAddress.line2 &&
                      `, ${agreement.serviceAddress.line2}`}
                    , {agreement.serviceAddress.city}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {agreement.lines.map((line) => line.label).join(", ")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {formatCents(
                      agreement.lines.reduce(
                        (sum, line) => sum + line.monthlyPriceCents,
                        0,
                      ),
                    )}
                    {t("per month")}
                  </p>
                  {agreement.outOfServicePeriods.map((away) => (
                    <p key={away.id} className="mt-2 text-sm text-ink">
                      {portalStatement(locale,"repair",{appliance:away.appliance.applianceType.name.toLowerCase(),date:formatBusinessDate(away.startedOn)})}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t("No active rentals")}
              description={t("An agreement awaiting signature or delivery may still be in progress.")}
            />
          )}

          {data.activeRentalCount > data.rentals.length && (
            <p className="mt-3 text-sm text-ink-soft">
              {t("Showing")} {data.rentals.length} {t("of")} {rentalCountLabel(locale, data.activeRentalCount, Boolean(data.addressId))}
            </p>
          )}
        </Card>

        <Card
          title={t("What's next?")}
          description={visitCountLabel(locale,data.upcomingVisitCount,Boolean(data.addressId))}
          actions={
            <ButtonLink href="/account/rentals" variant="secondary">{t("Visit history")}</ButtonLink>
          }
        >
          {data.nextVisit ? (
            <div>
              <p className="font-semibold text-ink">
                {jobTypeLabel(data.nextVisit.type, locale)}
              </p>
              <p className="mt-1 text-ink">
                {formatBusinessDate(data.nextVisit.scheduledAt!)} ·{" "}
                {formatBusinessTime(data.nextVisit.scheduledAt!)}
              </p>
              {data.nextVisit.scheduledAt! < new Date() && (
                <p className="mt-2 text-sm text-ink-soft">{t("This is the recorded visit time. Contact the business if you need an updated arrival time.")}</p>
              )}
              {data.nextVisit.serviceAddress && (
                <p className="mt-2 text-sm text-ink-soft">
                  {data.nextVisit.serviceAddress.line1}
                  {data.nextVisit.serviceAddress.line2 &&
                    `, ${data.nextVisit.serviceAddress.line2}`}
                  , {data.nextVisit.serviceAddress.city}
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              title={t("No scheduled visit")}
              description={
                data.upcomingVisitCount
                  ? t("A visit is being arranged; a date has not been set yet.")
                  : t("New visit details will appear once the business schedules them.")
              }
            />
          )}
        </Card>

        <Card
          title={t("Do I owe anything?")}
          description={t("Invoice amounts are separate from your rental rate and may include deposits, fees or tax.")}
          actions={
            <ButtonLink href="/account/billing" variant="secondary">{t("Open billing")}</ButtonLink>
          }
        >
          {data.invoice ? (
            <div>
              <p className="font-semibold text-ink">
                {t("Invoice")} #{data.invoice.invoiceNumber}
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {formatCents(
                  Math.max(
                    0,
                    data.invoice.amountDueCents -
                      data.invoice.amountPaidCents,
                  ),
                )}{" "}
                {t("remaining")}
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {data.invoice.status === "FAILED"
                  ? t("Payment needs attention.")
                  : t("Open invoice.")}{" "}
                {t("Billing shows your full history.")}
              </p>
              <ButtonLink
                href={`/account/billing/invoice/${data.invoice.id}`}
                variant="quiet"
                className="mt-3"
              >{t("View invoice")}</ButtonLink>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">
              {t("No open invoice found")} {data.addressId ? t("for this property") : ""}.
            </p>
          )}
        </Card>

        <Card
          title={t("How do I get help?")}
          description={requestCountLabel(locale,data.openRequestCount)}
        >
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/account/maintenance">{t("Report a problem")}</ButtonLink>
            <ButtonLink
              href="/account/maintenance?request=pickup"
              variant="secondary"
            >{t("Request pickup")}</ButtonLink>
          </div>
          <p className="mt-3 text-sm text-ink-soft">{t("Requests are reviewed by the business. A pickup request does not automatically cancel a rental or change billing.")}</p>
        </Card>
      </div>
    </div>
  );
}
