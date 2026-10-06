import Link from "next/link";
import { NoticeDeliveryForm } from "./notice-delivery-form";
import { MonthToMonthForm } from "./month-to-month-form";
import { EarlyReturnForm } from "./early-return-form";
import { earlyReturnDefaults, earlyReturnSettingsFrom } from "@/domains/settings/early-return";
import { MONTH_TO_MONTH_STARTING_DRAFTS, monthToMonthSettingsDefaults } from "@/domains/settings/month-to-month";
import { prisma } from "@/lib/prisma";
import { noticeDeliveryDefaults } from "@/domains/settings/notice-delivery";
import { getBusinessSettings, getAllApplianceTypes } from "@/domains/settings";
import { getLeadScoringPolicy } from "@/domains/leads/scoring-policy";
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
import { CustomerEmailSwitch } from "./customer-email-switch";
import { isNonProductionDeployment } from "@/lib/deployment-safety";
import { TermsPolicyForm } from "./terms-policy-form";
import { AutoRenewSwitch } from "./auto-renew-switch";
import { PickupBillingForm } from "./pickup-billing-form";
import { JobSchedulingForm } from "./job-scheduling-form";
import { LeadScoringForm } from "./lead-scoring-form";
import { jobSchedulingDefaults } from "@/domains/settings/job-scheduling";
import { pickupBillingDefaults } from "@/domains/settings/pickup-billing";
import { pickupBillingSettingsFrom } from "@/domains/billing/pickup-billing";
import { termsPolicyDefaults, termsPolicyStatus } from "@/domains/settings/terms-policy";
import { formatTaxRate } from "@/domains/billing/tax";
import { profileExtrasDefaults } from "@/domains/settings/profile-extras";
export const metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};
export default async function DeskSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const section = settingsSection((await searchParams).section);
  const settings = await getBusinessSettings();
  const leadScoringPolicy = section === "policies" ? await getLeadScoringPolicy() : null;
  let content: React.ReactNode;
  if (section === "products") {
    const applianceTypes = await getAllApplianceTypes();
    content = (
      <SectionCard
        title="Products and pricing"
        description="Signed agreements keep their existing prices. Catalog changes apply to new rentals."
      >
        <AppliancePricingTable
          rows={applianceTypes.map((t) => ({
            id: t.id,
            name: t.name,
            monthlyPriceCents: t.monthlyPriceCents,
            showOnWebsite: t.showOnWebsite,
            isActive: t.isActive,
            photoUrl: t.photoUrl,
          }))}
        />
      </SectionCard>
    );
  } else if (section === "terms") {
    const status = termsPolicyStatus(settings);
    const line = (label: string, feature: { available: boolean; missing: string[] }) => (
      <li key={label}>
        <span className="font-medium text-ink">{label}:</span>{" "}
        {feature.available
          ? "available to use."
          : `not available yet. Still needed: ${feature.missing.join("; ")}.`}
      </li>
    );
    content = (
      <SectionCard
        title="Ending and renewing rentals"
        description="Set the rules here whenever you like. Agreements already signed keep working; new quotes use what is saved."
      >
        <ul className="mb-6 space-y-1 rounded-lg bg-subtle p-3 text-sm text-ink-soft">
          {line("Ending early", status.earlyEnding)}
          {line("Automatic renewal", status.autoRenew)}
        </ul>
        <div className="mb-6">
          <AutoRenewSwitch
            enabled={settings.autoRenewEnabled === true}
            canChange={(session.user as { role?: string }).role === "OWNER"}
          />
        </div>
        <TermsPolicyForm defaultValues={termsPolicyDefaults(settings)} />
        <MonthToMonthForm
          defaultValues={monthToMonthSettingsDefaults(settings as { monthToMonthChangeNoticeDays?: number; termsChangeNoticeText?: string | null; annualReminderText?: string | null })}
          currentVersion={(await prisma.monthToMonthTermsVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } }))?.version ?? null}
          startingDrafts={MONTH_TO_MONTH_STARTING_DRAFTS}
        />
        <EarlyReturnForm defaultValues={earlyReturnDefaults(earlyReturnSettingsFrom(settings))} />
        <NoticeDeliveryForm
          defaultValues={noticeDeliveryDefaults(settings as { noticeCertifierRoles?: string; mailNoticeTransitDays?: number })}
          canChange={(session.user as { role?: string }).role === "OWNER"}
        />
      </SectionCard>
    );
  } else if (section === "pickups") {
    content = (
      <SectionCard
        title="Pickups and deliveries"
        description="What a customer is charged when an appliance comes back late, credited when one is delivered late, and whether the pickup day counts."
      >
        <PickupBillingForm defaultValues={pickupBillingDefaults(pickupBillingSettingsFrom(settings))} />
      </SectionCard>
    );
  } else if (section === "jobs") {
    content = (
      <SectionCard
        title="Visits and scheduling"
        description="How long a visit is assumed to take when checking whether the same person is booked twice."
      >
        <JobSchedulingForm defaultValues={jobSchedulingDefaults(settings)} />
      </SectionCard>
    );
  } else if (section === "staff") {
    const accounts = await getStaffAccounts();
    content = (
      <SectionCard title="Staff accounts">
        <StaffAccountsSection
          accounts={accounts.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            createdAt: a.createdAt,
            isActive: a.archivedAt === null,
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
          <Link className={secondaryActionClass} href="/desk/settings/website">
            Edit website text
          </Link>
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
          Use Edit website text for the wording on your pages. Use Business
          profile, Service area, and Products and pricing for contact details,
          where you work and prices.
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
        {section === "notifications" && (
          <div className="mb-6 rounded-lg border border-line-strong p-4">
            <CustomerEmailSwitch
              enabled={settings.customerEmailEnabled === true}
              canChange={(session.user as { role?: string }).role === "OWNER"}
              preview={isNonProductionDeployment()}
            />
          </div>
        )}
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
        title={SETTINGS_SECTIONS.find((s) => s.id === section)!.label}
        description="Save only this section. Prices, staff accounts and other sections are preserved."
      >
        {section === "policies" && leadScoringPolicy && (
          <LeadScoringForm policy={leadScoringPolicy} />
        )}
        {section === "policies" && (
          <div className="mb-4 rounded-lg border border-line bg-subtle p-4">
            <p className="text-sm text-ink-soft">
              The return inspection checklist is versioned separately so changing it never rewrites an inspection that
              already happened.
            </p>
            <Link className={`${secondaryActionClass} mt-3`} href="/desk/settings/policies">
              Edit return inspection checklist
            </Link>
          </div>
        )}
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
            ...profileExtrasDefaults(settings),
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
            taxRatePercentText: formatTaxRate(settings.taxRateMilliPercent).replace("%", ""),
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
        items={SETTINGS_SECTIONS.map((s) => ({
          href: `/desk/settings?section=${s.id}`,
          label: s.label,
          active: s.id === section,
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
