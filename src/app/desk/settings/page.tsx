import Link from "next/link";
import { getBusinessSettings, getAllApplianceTypes } from "@/domains/settings";
import { getStaffAccounts } from "@/domains/staff";
import { requireRole } from "@/lib/session";
import {
  SETTINGS_SECTIONS,
  settingsSection,
} from "@/domains/settings/section-config";
import { providerStatus } from "@/domains/settings/provider-status";
import {
  PageHeader,
  FilterBar,
  SectionCard,
  secondaryActionClass,
} from "@/components/desk/workspace";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { SettingsForm } from "./settings-form";
import { AppliancePricingTable } from "./appliance-pricing-table";
import { StaffAccountsSection } from "./staff-accounts-section";

export const metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function DeskSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const section = settingsSection((await searchParams).section);
  const settings = await getBusinessSettings();
  let content: React.ReactNode;

  if (section === "products") {
    const applianceTypes = await getAllApplianceTypes();
    content = (
      <SectionCard
        title="Products and pricing"
        description="Signed agreements keep their existing prices. Catalog changes apply to new rentals."
      >
        <AppliancePricingTable
          rows={applianceTypes.map((type) => ({
            id: type.id,
            name: type.name,
            monthlyPriceCents: type.monthlyPriceCents,
            showOnWebsite: type.showOnWebsite,
            isActive: type.isActive,
            photoUrl: type.photoUrl,
          }))}
        />
      </SectionCard>
    );
  } else if (section === "staff") {
    const accounts = await getStaffAccounts();
    content = (
      <SectionCard title="Staff accounts">
        <StaffAccountsSection
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            email: account.email,
            createdAt: account.createdAt,
            isActive: account.archivedAt === null,
          }))}
        />
      </SectionCard>
    );
  } else if (section === "website") {
    content = (
      <SectionCard
        title="Website controls"
        description="The public site uses your saved business profile, service area and catalog pricing."
      >
        <div className="flex flex-wrap gap-2">
          <Link className={secondaryActionClass} href="/desk/launch">
            Launch signup and announcement controls
          </Link>
          <Link
            className={secondaryActionClass}
            href="/"
            target="_blank"
            rel="noopener noreferrer"
          >
            View public website
          </Link>
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Use Business profile, Service area, and Products and pricing to update
          the information customers see on the public website.
        </p>
      </SectionCard>
    );
  } else if (section === "notifications" || section === "integrations") {
    const status = providerStatus();
    content = (
      <SectionCard
        title={
          section === "notifications"
            ? "Notification configuration"
            : "Connected services"
        }
        description="Configuration is shown separately from verified delivery. No credentials are displayed."
      >
        <dl className="space-y-4">
          {status.map((item) => (
            <div key={item.name}>
              <dt className="font-medium text-ink">{item.name}</dt>
              <dd className="mt-1 text-sm text-ink-soft">{item.state}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-ink-soft">
          Customer SMS preferences remain in each customer&apos;s account.
          Launch email controls are managed separately.
        </p>
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
          href="/desk/launch"
        >
          Open launch email controls
        </Link>
      </SectionCard>
    );
  } else {
    content = (
      <SectionCard
        title={SETTINGS_SECTIONS.find((candidate) => candidate.id === section)!.label}
        description="Save only this section. Prices, staff accounts and other sections are preserved."
      >
        {section === "policies" && !settings.taxRateConfirmed && (
          <p
            role="status"
            className="mb-4 rounded-lg bg-subtle p-3 text-sm text-ink"
          >
            Sales tax is not confirmed. Keep the current approval process before
            using a rate with customers.
          </p>
        )}
        <SettingsForm
          key={section}
          section={section}
          defaultValues={{
            publicBusinessName: settings.publicBusinessName,
            publicPhone: settings.publicPhone,
            publicEmail: settings.publicEmail,
            publicAddress: settings.publicAddress,
            serviceAreaCities: Array.isArray(settings.serviceAreaCities)
              ? (settings.serviceAreaCities as string[]).join(", ")
              : "",
            serviceAreaZips: Array.isArray(settings.serviceAreaZips)
              ? (settings.serviceAreaZips as string[]).join(", ")
              : "",
            deliveryFeeDollars: settings.oneTimeDeliveryFeeCents / 100,
            installationFeeDollars: settings.oneTimeInstallationFeeCents / 100,
            removalFeeDollars: settings.oneTimeRemovalFeeCents / 100,
            damageWaiverEnabled: settings.damageWaiverEnabled,
            depositEnabled: settings.depositEnabled,
            lateFeeGraceDays: settings.lateFeeGraceDays,
            lateFeeFlatDollars: settings.lateFeeFlatCents / 100,
            lateFeePercent: settings.lateFeePercent,
            taxRatePercent: settings.taxRatePermille / 1000,
            taxRateConfirmed: settings.taxRateConfirmed,
            sixMonthPrepaySetDollars:
              settings.sixMonthPrepayDiscountSetCents / 100,
            sixMonthPrepaySingleDollars:
              settings.sixMonthPrepayDiscountSingleCents / 100,
            twelveMonthPrepaySetDollars:
              settings.twelveMonthPrepayDiscountSetCents / 100,
            twelveMonthPrepaySingleDollars:
              settings.twelveMonthPrepayDiscountSingleCents / 100,
            twelveMonthPrepayFreeMonthEnabled:
              settings.twelveMonthPrepayFreeMonthEnabled,
            referralRewardDollars: settings.referralRewardCents / 100,
            draftReservationHoldDays: settings.draftReservationHoldDays,
          }}
        />
      </SectionCard>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Settings"
        description="Manage the business one section at a time."
        secondaryActions={
          <Link className={secondaryActionClass} href="/desk/activity">
            View change history
          </Link>
        }
      />
      <FilterBar
        label="Settings sections"
        items={SETTINGS_SECTIONS.map((candidate) => ({
          href: `/desk/settings?section=${candidate.id}`,
          label: candidate.label,
          active: candidate.id === section,
        }))}
      />
      <p className="mb-4 text-xs text-ink-soft">
        Business settings last saved: {formatBusinessDate(settings.updatedAt)} ·{" "}
        {formatBusinessTime(settings.updatedAt)}. Catalog and staff changes have
        their own entries in change history.
      </p>
      {content}
    </div>
  );
}
