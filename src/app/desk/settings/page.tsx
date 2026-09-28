import { getBusinessSettings, getAllApplianceTypes } from "@/domains/settings";
import { getStaffAccounts } from "@/domains/staff";
import { requireRole } from "@/lib/session";
import { SettingsForm } from "./settings-form";
import { AppliancePricingTable } from "./appliance-pricing-table";
import { StaffAccountsSection } from "./staff-accounts-section";

export const metadata = {
  robots: { index: false, follow: false },
};

// The layout lets STAFF into /desk generally (docs/DECISIONS.md,
// 2026-09-28 "Staff permissions framework"), so Settings needs its own
// explicit OWNER/ADMIN gate now — never rely on the nav link being
// hidden alone. The server actions this page calls (actions.ts) check
// it again themselves too, since a Server Action call is a separate
// request from the page's render — see docs/ARCHITECTURE.md.
export default async function DeskSettingsPage() {
  await requireRole("OWNER", "ADMIN");
  const [settings, applianceTypes, staffAccounts] = await Promise.all([
    getBusinessSettings(),
    getAllApplianceTypes(),
    getStaffAccounts(),
  ]);

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-gray-600">
          What shows up on the public website, plus pricing and fees. Every
          change here is logged (who, when, old → new) in the activity log.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Appliance pricing
        </h2>
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
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Staff accounts
        </h2>
        <StaffAccountsSection
          accounts={staffAccounts.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            createdAt: a.createdAt,
            isActive: a.archivedAt === null,
          }))}
        />
      </section>

      <section>
        <SettingsForm
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
            taxRatePermille: settings.taxRatePermille,
            taxRateConfirmed: settings.taxRateConfirmed,
            sixMonthPrepaySetDollars: settings.sixMonthPrepayDiscountSetCents / 100,
            sixMonthPrepaySingleDollars: settings.sixMonthPrepayDiscountSingleCents / 100,
            twelveMonthPrepaySetDollars: settings.twelveMonthPrepayDiscountSetCents / 100,
            twelveMonthPrepaySingleDollars:
              settings.twelveMonthPrepayDiscountSingleCents / 100,
            twelveMonthPrepayFreeMonthEnabled: settings.twelveMonthPrepayFreeMonthEnabled,
            draftReservationHoldDays: settings.draftReservationHoldDays,
          }}
        />
      </section>
    </div>
  );
}
