// AR-8: the settings page is the catalog. Sections and rows come from
// src/domains/settings/catalog.ts; every scalar saves through the row
// save with its revision; the big editors stay and open from their panel
// rows. Old ?section= ids redirect to the new sections.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { centsAsDollars } from "@/lib/money-ui";
import { NoticeDeliveryForm } from "./notice-delivery-form";
import { MonthToMonthForm } from "./month-to-month-form";
import { EarlyReturnForm } from "./early-return-form";
import { earlyReturnDefaults, earlyReturnSettingsFrom } from "@/domains/settings/early-return";
import { MONTH_TO_MONTH_STARTING_DRAFTS, monthToMonthSettingsDefaults } from "@/domains/settings/month-to-month";
import { prisma } from "@/lib/prisma";
import { allSpanishSurfacesReady, getSpanishReview } from "@/domains/language/review";
import { SpanishReviewForm } from "./spanish-review-form";
import { listCurrentTranslationDrafts } from "@/domains/language/drafts";
import { SpanishDraftsEditor } from "./spanish-drafts-editor";
import { noticeDeliveryDefaults } from "@/domains/settings/notice-delivery";
import { getBusinessSettings, getAllApplianceTypes } from "@/domains/settings";
import { getLeadScoringPolicy } from "@/domains/leads/scoring-policy";
import { servicePriceWarnings } from "@/domains/orders/service-cost-warnings";
import { getTeam, getTeamSettings } from "@/domains/team";
import { listJobRoles } from "@/domains/team/job-roles";
import { requireRole } from "@/lib/session";
import { providerStatus } from "@/domains/settings/provider-status";
import { ButtonLink, Card } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { SigningChargeForm } from "./signing-charge-form";
import { BankPaymentForm } from "./bank-payment-form";
import { LateFeeNoticeForm } from "./late-fee-notice-form";
import { UcccFilingForm } from "./uccc-filing-form";
import { MandatorySigningPolicyForm } from "./mandatory-signing-policy-form";
import { effectiveMandatorySigningPolicy, parseMandatorySigningPolicyVersions } from "@/domains/billing/signing-mandatory-policy";
import { businessDateKey } from "@/lib/business-date";
import { getEffectiveSetupTaxTreatment } from "@/domains/billing/setup-tax-policy-version";
import { AppliancePricingTable } from "./appliance-pricing-table";
import { PackageTable } from "./package-table";
import { listPackagesForSettings } from "@/domains/packages";
import { TeamSection } from "./team-section";
import { CertificationSection } from "./certification-section";
import { listTeamCertifications } from "@/domains/certifications/actions";
import { CustomerEmailSwitch } from "./customer-email-switch";
import { SmsTemplatePreview } from "./sms-template-preview";
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
import { profileExtrasDefaults } from "@/domains/settings/profile-extras";
import { sectionRevision } from "@/domains/settings/preview";
import { twoFactorRolesFromSetting } from "@/domains/security/two-factor";
import { updateSecondStepSettingsAction, updateSignInPauseAction, updateTwoFactorRequiredRolesAction } from "./actions";
import { getPauseSettings } from "@/domains/security/sign-in-guard";
import { getMethodSettings, twilioKeysPresent } from "@/domains/security/second-step";
import { EMAIL_WEAKER_WARNING, METHOD_LABEL } from "@/domains/security/second-step-rules";
import { DeliveryZonesForm } from "./delivery-zones-form";
import { ServiceAreaMap } from "@/components/site/service-area-map";
import { readZoneSettings } from "@/domains/delivery/zone";
import { townsWithZones } from "@/domains/delivery/towns";
import { zoneSettingsRevision } from "@/domains/delivery/settings";
import {
  OLD_SECTION_REDIRECTS,
  SETTINGS_SECTIONS_V2,
  type SettingsSectionId,
} from "@/domains/settings/catalog";
import { getSettingsPage } from "@/domains/settings/page-data";
import { settingEffect } from "@/domains/settings/effects";
import { formatSettingValue } from "@/domains/settings/history";
import { PanelRow, RowAnchorFlash, SettingRow, SettingsIndex, type SettingRowData } from "@/components/kit";
import { Toaster } from "@/components/kit/toaster";

const FMT_KIND = {
  money: "money", days: "days", hours: "hours", minutes: "number", number: "number",
  percent: "percent", yesno: "yesno", text: "text", list: "list", choice: "choice",
  panel: "text", link: "text",
} as const;

export const metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

function resolveSection(raw: string | undefined): SettingsSectionId | null {
  if (!raw) return null;
  if (SETTINGS_SECTIONS_V2.some((s) => s.id === raw)) return raw as SettingsSectionId;
  return OLD_SECTION_REDIRECTS[raw] ?? "business";
}

export default async function DeskSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const role = session.user.role === "OWNER" ? "OWNER" : "ADMIN";
  const raw = (await searchParams).section;
  const section = resolveSection(raw);
  if (raw && section && raw !== section) {
    redirect(`/desk/settings?section=${section}`);
  }
  if (!section) {
    return (
      <div>
        <SettingsIndex attention={[]} role={role} />
        <Toaster />
      </div>
    );
  }

  const settings = await getBusinessSettings();
  const page = await getSettingsPage(section);
  const isOwner = role === "OWNER";

  // ---- panel contents (the existing editors, opened from their rows) ----
  const panels: Record<string, ReactNode> = {};
  let extra: ReactNode = null;
  let topExtra: ReactNode = null;

  if (section === "business") {
    const profileForm = (
      <SettingsForm
        section="profile"
        revision={sectionRevision(settings, "profile")}
        defaultValues={{
          publicBusinessName: settings.publicBusinessName,
          publicPhone: settings.publicPhone,
          publicEmail: settings.publicEmail,
          publicAddress: settings.publicAddress,
          ...profileExtrasDefaults(settings),
          serviceAreaCities: Array.isArray(settings.serviceAreaCities) ? (settings.serviceAreaCities as string[]).join(", ") : "",
          serviceAreaZips: Array.isArray(settings.serviceAreaZips) ? (settings.serviceAreaZips as string[]).join(", ") : "",
          deliveryFeeDollars: centsAsDollars(settings.oneTimeDeliveryFeeCents),
          installationFeeDollars: centsAsDollars(settings.oneTimeInstallationFeeCents),
          removalFeeDollars: centsAsDollars(settings.oneTimeRemovalFeeCents),
          haulAwayFeeDollars: centsAsDollars(settings.oneTimeHaulAwayFeeCents),
          damageWaiverEnabled: settings.damageWaiverEnabled,
          depositEnabled: settings.depositEnabled,
          lateFeeGraceDays: settings.lateFeeGraceDays,
          lateFeeFlatDollars: centsAsDollars(settings.lateFeeFlatCents),
          lateFeePercent: settings.lateFeePercent,
          sixMonthPrepaySetDollars: centsAsDollars(settings.sixMonthPrepayDiscountSetCents),
          sixMonthPrepaySingleDollars: centsAsDollars(settings.sixMonthPrepayDiscountSingleCents),
          twelveMonthPrepaySetDollars: centsAsDollars(settings.twelveMonthPrepayDiscountSetCents),
          twelveMonthPrepaySingleDollars: centsAsDollars(settings.twelveMonthPrepayDiscountSingleCents),
          twelveMonthPrepayFreeMonthEnabled: settings.twelveMonthPrepayFreeMonthEnabled,
          referralRewardDollars: centsAsDollars(settings.referralRewardCents),
          draftReservationHoldDays: settings.draftReservationHoldDays,
          receiptFileKeepDays: settings.receiptFileKeepDays,
          unsentPhotoKeepDays: settings.unsentPhotoKeepDays,
        }}
      />
    );
    panels["hoursPanel"] = profileForm;
    panels["socialLinksPanel"] = profileForm;
    panels["logoPanel"] = profileForm;
    panels["serviceAreaPanel"] = profileForm;
    const zones = readZoneSettings(settings);
    const towns = townsWithZones(zones);
    panels["deliveryZonesPanel"] = (
      <div>
        <div className="mb-5 rounded-card border border-line bg-subtle p-4 text-sm text-ink-soft">
          <p><strong className="text-ink">Starting values (your answer of 2026-10-13):</strong> up to 15 miles free, over 15 to 30 miles $75,
            over 30 to 50 miles $125, beyond 50 miles pickup only. Distance is a straight line from the center (your answer of 2026-10-25).</p>
          <p className="mt-2">Delivery is always optional: every estimate also offers “I’ll pick it up” for $0. Changes apply to estimates
            checked from now on; sent estimates and signed agreements keep the zone they were given. Only the owner can change these.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <DeliveryZonesForm settings={zones} revision={zoneSettingsRevision(zones)} canChange={isOwner} />
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Map preview (saved zones)</p>
            <ServiceAreaMap id="settings-zone-map" settings={zones} towns={towns}
              copy={{ title: "Preview of your delivery zone map", north: "N", scale: "10 miles", center: "Center" }} />
          </div>
        </div>
      </div>
    );
  }

  if (section === "prices") {
    const [applianceTypes, packages, activeSetupTaxTreatment, upcomingSetupPolicies] = await Promise.all([
      getAllApplianceTypes(),
      listPackagesForSettings(),
      getEffectiveSetupTaxTreatment(),
      prisma.setupFeeTaxDecisionVersion.findMany({
        where: { effectiveFromKey: { gt: businessDateKey(new Date()) }, cancelledAt: null },
        orderBy: [{ effectiveFromKey: "asc" }, { ownerApprovedAt: "desc" }], take: 10,
        select: { id: true, effectiveFromKey: true, treatment: true },
      }),
    ]);
    panels["appliancePricesPanel"] = (
      <AppliancePricingTable
        rows={applianceTypes.map((t) => ({
          id: t.id, name: t.name, monthlyPriceCents: t.monthlyPriceCents,
          showOnWebsite: t.showOnWebsite, isActive: t.isActive, photoUrl: t.photoUrl,
        }))}
      />
    );
    panels["packagesPanel"] = (
      <PackageTable
        packages={packages.map((p) => ({
          id: p.id, name: p.name, monthlyPriceCents: p.monthlyPriceCents,
          showOnWebsite: p.showOnWebsite, isActive: p.isActive,
          components: p.components.map((c) => ({
            applianceTypeId: c.applianceTypeId, name: c.applianceType.name,
            quantity: c.quantity, monthlyPriceCents: c.applianceType.monthlyPriceCents,
            isActive: c.applianceType.isActive,
          })),
        }))}
        types={applianceTypes.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, monthlyPriceCents: t.monthlyPriceCents }))}
      />
    );
    panels["signingChargesPanel"] = (
      <SigningChargeForm editable={isOwner}
        activeTaxTreatment={activeSetupTaxTreatment} upcomingPolicies={upcomingSetupPolicies} settings={{
          administrativeSetupFeeCents: settings.administrativeSetupFeeCents,
          largeOrderMachineThreshold: settings.largeOrderMachineThreshold,
          largeOrderCancellationFullRefundHours: settings.largeOrderCancellationFullRefundHours,
          businessRequiresDownPayment: settings.businessRequiresDownPayment,
          setupFeeTaxTreatment: settings.setupFeeTaxTreatment,
          setupFeeTaxDecisionNote: settings.setupFeeTaxDecisionNote,
          setupFeeTaxPlanningTreatment: settings.setupFeeTaxPlanningTreatment,
          setupFeeTaxConfirmedOn: settings.setupFeeTaxConfirmedOn,
          setupFeeTaxEffectiveFrom: settings.setupFeeTaxEffectiveFrom,
          setupFeeTaxApprovedAt: settings.setupFeeTaxApprovedAt,
          setupFeeTaxAdviserReference: settings.setupFeeTaxAdviserReference,
          updatedAt: settings.updatedAt,
        }} />
    );
    panels["mandatoryFeesPanel"] = (
      <MandatorySigningPolicyForm editable={isOwner} effectiveDate={businessDateKey(new Date())}
        current={effectiveMandatorySigningPolicy(settings.signingMandatoryPolicyVersions)}
        history={parseMandatorySigningPolicyVersions(settings.signingMandatoryPolicyVersions)} />
    );
  }

  if (section === "rentals") {
    const [leadScoringPolicy, serviceWarnings] = await Promise.all([getLeadScoringPolicy(), servicePriceWarnings()]);
    const status = termsPolicyStatus(settings);
    const line = (label: string, feature: { available: boolean; missing: string[] }) => (
      <li key={label}>
        <span className="font-medium text-ink">{label}:</span>{" "}
        {feature.available ? "available to use." : `not available yet. Still needed: ${feature.missing.join("; ")}.`}
      </li>
    );
    panels["endingTermsPanel"] = (
      <div>
        <ul className="mb-6 space-y-1 rounded-card bg-subtle p-3 text-sm text-ink-soft">
          {line("Ending early", status.earlyEnding)}
          {line("Automatic renewal", status.autoRenew)}
        </ul>
        <TermsPolicyForm defaultValues={termsPolicyDefaults(settings)} />
      </div>
    );
    panels["autoRenewPanel"] = <AutoRenewSwitch enabled={settings.autoRenewEnabled === true} canChange={isOwner} />;
    panels["monthToMonthPanel"] = (
      <MonthToMonthForm
        defaultValues={monthToMonthSettingsDefaults(settings as { monthToMonthChangeNoticeDays?: number; termsChangeNoticeText?: string | null; annualReminderText?: string | null })}
        currentVersion={(await prisma.monthToMonthTermsVersion.findFirst({ orderBy: { version: "desc" }, select: { version: true } }))?.version ?? null}
        startingDrafts={MONTH_TO_MONTH_STARTING_DRAFTS}
      />
    );
    panels["earlyReturnPanel"] = <EarlyReturnForm defaultValues={earlyReturnDefaults(earlyReturnSettingsFrom(settings))} />;
    panels["noticesPanel"] = (
      <NoticeDeliveryForm
        defaultValues={noticeDeliveryDefaults(settings as { noticeCertifierRoles?: string; mailNoticeTransitDays?: number })}
        canChange={isOwner}
      />
    );
    panels["pickupBillingPanel"] = <PickupBillingForm defaultValues={pickupBillingDefaults(pickupBillingSettingsFrom(settings))} />;
    panels["jobSchedulingPanel"] = <JobSchedulingForm defaultValues={jobSchedulingDefaults(settings)} />;
    panels["leadScoringPanel"] = <LeadScoringForm policy={leadScoringPolicy} />;
    panels["bankPaymentSlowBusinessDays"] = <BankPaymentForm editable={isOwner} days={settings.bankPaymentSlowBusinessDays ?? 6} />;
    panels["lateFeeNoticeDaysBefore"] = <LateFeeNoticeForm editable={isOwner} days={settings.lateFeeNoticeDaysBefore ?? 2} />;
    if (serviceWarnings.length > 0) {
      topExtra = (
        <div className="mb-4 rounded-card border border-amber-300 bg-amber-50 p-4" role="note">
          <p className="text-sm font-medium text-amber-900">Service prices well above cost</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {serviceWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      );
    }
    extra = (
      <>
        <Card title="Return inspection checklist" className="mt-6">
          <p className="text-sm text-ink-soft">
            The return inspection checklist is versioned separately so changing it never rewrites an inspection that
            already happened.
          </p>
          <div className="mt-3">
            <ButtonLink href="/desk/settings/policies" variant="secondary">Edit return inspection checklist</ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  if (section === "team") {
    const [team, teamSettings, jobRoles, certifications, methodSettings, pauseSettings] = await Promise.all([
      getTeam(),
      getTeamSettings(),
      listJobRoles({ includeArchived: isOwner }),
      isOwner ? listTeamCertifications() : Promise.resolve([]),
      getMethodSettings(),
      getPauseSettings(),
    ]);
    const teamNode = (
      <div>
        <TeamSection
          viewerRole={isOwner ? "OWNER" : "ADMIN"}
          viewerId={session.user.id}
          settings={teamSettings}
          jobRoles={jobRoles}
          members={team.members.map((m) => ({ ...m, lastSignIn: m.lastSignIn ? m.lastSignIn.toISOString() : null, accessEndsOn: m.accessEndsOn ? m.accessEndsOn.toISOString() : null }))}
          invitations={team.invitations.map((i) => ({ id: i.id, name: i.name, email: i.email, accessLevel: i.accessLevel, state: i.state, expiresAt: i.expiresAt.toISOString(), firm: i.firm, accessEndsOn: i.accessEndsOn ? i.accessEndsOn.toISOString() : null }))}
        />
        {isOwner && (
          <div className="mt-6">
            <CertificationSection people={certifications.map((c) => ({ id: c.id, name: c.name, role: c.role, certification: c.certification ? { certificationNumber: c.certification.certificationNumber, issuedOn: c.certification.issuedOn ? c.certification.issuedOn.toISOString().slice(0, 10) : null } : null }))} />
          </div>
        )}
      </div>
    );
    panels["teamPanel"] = teamNode;
    panels["jobRolesPanel"] = teamNode;
    const requiredRoles = twoFactorRolesFromSetting(settings.twoFactorRequiredRoles);
    const canChange = isOwner;
    panels["twoFactorPanel"] = (
      <form action={updateTwoFactorRequiredRolesAction} className="space-y-4">
        <fieldset disabled={!canChange} className="space-y-3">
          <legend className="font-medium text-ink">Roles that must use two-step login</legend>
          <p className="text-sm text-ink-soft">
            Anyone in these roles must enter a 6-digit code from an authenticator app after their password.
            Recommended: Owner and Admin, because they can refund money and see every customer.
          </p>
          {(["OWNER", "ADMIN", "STAFF"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="role" value={r} defaultChecked={requiredRoles.includes(r)} className="h-4 w-4" />
              {r === "OWNER" ? "Owner" : r === "ADMIN" ? "Admin" : "Staff"}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked disabled className="h-4 w-4" />
            Accountant — always required, it can’t be switched off
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!canChange} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Save security policy</button>
          <button type="submit" name="restoreRecommended" value="1" disabled={!canChange} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">Restore recommended</button>
        </div>
        {!canChange && <p className="text-sm text-ink-soft">Only the Owner can change which roles are required.</p>}
        <p className="text-xs text-ink-soft">Customer accounts can never be required by this setting.</p>
      </form>
    );
    panels["secondStepPanel"] = (
      <form action={updateSecondStepSettingsAction} className="space-y-4">
        <fieldset disabled={!canChange} className="space-y-4">
          <legend className="font-medium text-ink">How each access level may get its second step</legend>
          <p className="text-sm text-ink-soft">
            The authenticator app is always allowed. Starting value: owner and admins may use the authenticator or text codes; staff may also use email codes.
            Changing this never signs anyone out: people already using a method keep it and are asked to switch.
          </p>
          {(["OWNER", "ADMIN", "STAFF"] as const).map((level) => (
            <div key={level} className="space-y-1">
              <p className="text-sm font-medium text-ink">{level === "OWNER" ? "Owner" : level === "ADMIN" ? "Admins" : "Staff"}</p>
              <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked disabled className="h-4 w-4" /> {METHOD_LABEL.TOTP} (always)</label>
              {(["SMS", "EMAIL"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name={`method-${level}`} value={m} defaultChecked={methodSettings.policy[level].includes(m)} className="h-4 w-4" />
                  {METHOD_LABEL[m]}
                </label>
              ))}
            </div>
          ))}
          <p className="text-xs text-ink-soft">{EMAIL_WEAKER_WARNING}</p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="securitySmsEnabled" value="1" defaultChecked={methodSettings.securitySmsEnabled} className="mt-1 h-4 w-4" />
            <span>
              Send sign-in codes by text
              <span className="block text-xs text-ink-soft">
                Separate from customer texting. Starting value off. Text codes only go out on the live site, and only when your phone-provider keys are in place
                ({twilioKeysPresent() ? "keys are in place" : "keys are not in place yet"}).
              </span>
            </span>
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!canChange} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Save sign-in code rules</button>
          <button type="submit" name="restoreRecommended" value="1" disabled={!canChange} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">Restore recommended</button>
        </div>
        {!canChange && <p className="text-sm text-ink-soft">Only the Owner can change these rules.</p>}
      </form>
    );
    panels["signInPausePanel"] = (
      <form action={updateSignInPauseAction} className="space-y-4">
        <fieldset disabled={!canChange} className="space-y-3">
          <legend className="font-medium text-ink">Wrong passwords</legend>
          <p className="text-sm text-ink-soft">
            After this many wrong passwords on one account inside the wait time, that account waits before it can try again and the person gets an email.
            Starting value: 10 wrong passwords, 15 minutes.
          </p>
          <label className="block text-sm text-ink">Wrong passwords allowed
            <input name="attempts" type="number" min={3} max={50} defaultValue={pauseSettings.attempts} className="mt-1 block w-28 rounded-control border border-line-strong bg-surface px-3 py-2 text-ink" />
          </label>
          <label className="block text-sm text-ink">Wait (minutes)
            <input name="minutes" type="number" min={1} max={240} defaultValue={pauseSettings.minutes} className="mt-1 block w-28 rounded-control border border-line-strong bg-surface px-3 py-2 text-ink" />
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!canChange} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Save wrong-password rules</button>
          <button type="submit" name="restoreRecommended" value="1" disabled={!canChange} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">Restore recommended</button>
        </div>
      </form>
    );
  }

  if (section === "messages") {
    const [spanishReview, spanishDrafts] = await Promise.all([getSpanishReview(), listCurrentTranslationDrafts()]);
    panels["customerEmailPanel"] = (
      <CustomerEmailSwitch enabled={settings.customerEmailEnabled === true} canChange={isOwner} preview={isNonProductionDeployment()} />
    );
    panels["spanishPanel"] = (
      <div>
        {spanishDrafts.length > 0 && (
          <div className="mb-6">
            <SpanishDraftsEditor sources={spanishDrafts} />
          </div>
        )}
        {spanishReview && (
          <SpanishReviewForm surfacesReady={allSpanishSurfacesReady} digest={spanishReview.currentDigest}
            currentReview={spanishReview.currentReview}
            reviewedAt={spanishReview.reviewedAt?.toISOString() ?? null}
            legalReviewedAt={spanishReview.legalReviewedAt?.toISOString() ?? null}
            publishedAt={spanishReview.publishedAt?.toISOString() ?? null}
            reviewerName={spanishReview.reviewerName} />
        )}
      </div>
    );
    extra = <SmsTemplatePreview />;
  }

  if (section === "money") {
    extra = (
      <Card title="Colorado consumer lease filing" className="mt-6">
        <p className="mb-3 text-sm text-ink-soft">Needed before the first household rental over 4 months.</p>
        <UcccFilingForm editable={isOwner} filedOn={settings.ucccNotificationFiledOn ? businessDateKey(settings.ucccNotificationFiledOn) : null} />
      </Card>
    );
  }

  if (section === "advanced") {
    const status = providerStatus();
    panels["connectedServicesPanel"] = (
      <dl className="space-y-4">
        {status.map((item) => (
          <div key={item.name}>
            <dt className="font-medium text-ink">{item.name}</dt>
            <dd className="mt-1 text-sm text-ink-soft">{item.state}</dd>
          </div>
        ))}
      </dl>
    );
  }

  // ---- summaries the spec names ----
  const summaries: Record<string, string> = {};
  if (section === "business") {
    const cities = Array.isArray(settings.serviceAreaCities) ? (settings.serviceAreaCities as unknown[]).length : 0;
    const zips = Array.isArray(settings.serviceAreaZips) ? (settings.serviceAreaZips as unknown[]).length : 0;
    summaries["serviceAreaPanel"] = `${cities} cities · ${zips} ZIP codes`;
    summaries["drivingOriginPanel"] = settings.drivingOriginAddress && !String(settings.drivingOriginAddress).startsWith("UNVERIFIED")
      ? String(settings.drivingOriginAddress)
      : "Not set";
  }
  if (section === "prices") {
    summaries["appliancePricesPanel"] = `${(await getAllApplianceTypes()).length} appliance types`;
    summaries["packagesPanel"] = `${(await listPackagesForSettings()).length} sets`;
  }

  // ---- render the section's rows in catalog order, grouped ----
  const groups: { name?: string; rows: typeof page.rows }[] = [];
  for (const r of page.rows) {
    const name = r.def.group;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push(r);
    else groups.push({ name, rows: [r] });
  }

  const sectionLabel = SETTINGS_SECTIONS_V2.find((s) => s.id === section)!.label;

  return (
    <div>
      <h1 className="sr-only">Settings — {sectionLabel}</h1>
      {topExtra}
      {groups.map((g) => (
        <section key={g.name ?? "top"} className="mb-6">
          {g.name && <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-soft">{g.name}</h2>}
          <div>
            {g.rows.map((r) => {
              const def = r.def;
              if (def.editor === "row" || (typeof def.editor === "object" && "domainWriter" in def.editor)) {
                const data: SettingRowData = {
                  key: def.key,
                  label: def.label,
                  kind: def.kind,
                  choices: def.choices,
                  min: def.min,
                  max: def.max,
                  what: def.what,
                  why: def.why,
                  who: def.who,
                  effect: def.appliesTo ?? settingEffect(def.key),
                  value: r.value,
                  display: r.display,
                  recommended: r.recommended,
                  recommendedDisplay: r.recommended !== undefined ? formatSettingValue(FMT_KIND[def.kind], r.recommended) : undefined,
                  lastChange: r.lastChange ? { by: r.lastChange.by, at: r.lastChange.at.toISOString() } : null,
                  state: r.state,
                  editable: r.editable,
                  revision: r.revision,
                };
                return <SettingRow key={def.key} row={data} />;
              }
              const href = typeof def.editor === "object" && "panelHref" in def.editor ? def.editor.panelHref : undefined;
              return (
                <PanelRow key={def.key} label={def.label} what={def.what} summary={summaries[def.key]} href={href}>
                  {href ? undefined : panels[def.key]}
                </PanelRow>
              );
            })}
          </div>
        </section>
      ))}
      {extra}
      <RowAnchorFlash />
      <Toaster />
    </div>
  );
}
