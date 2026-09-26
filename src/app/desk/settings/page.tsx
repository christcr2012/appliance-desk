import { getBusinessSettings, getAllApplianceTypes } from "@/domains/settings";
import { SettingsForm } from "./settings-form";
import { AppliancePricingTable } from "./appliance-pricing-table";

export const metadata = {
  robots: { index: false, follow: false },
};

// requireRole("OWNER", "ADMIN") already runs in src/app/desk/layout.tsx for
// every /desk/** page. The server actions this page calls (actions.ts)
// check it again themselves, since a Server Action call is a separate
// request from the layout's render — see docs/ARCHITECTURE.md.
export default async function DeskSettingsPage() {
  const [settings, applianceTypes] = await Promise.all([
    getBusinessSettings(),
    getAllApplianceTypes(),
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
          }}
        />
      </section>
    </div>
  );
}
