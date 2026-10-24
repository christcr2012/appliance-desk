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
import { getTeam, getTeamSettings } from "@/domains/team";
import { requireRole } from "@/lib/session";
import {
  SETTINGS_SECTIONS,
  settingsSection,
} from "@/domains/settings/section-config";
import { providerStatus } from "@/domains/settings/provider-status";
import { FilterBar } from "@/components/desk/workspace";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { SettingsForm } from "./settings-form";
import { SigningChargeForm } from "./signing-charge-form";
import { MandatorySigningPolicyForm } from "./mandatory-signing-policy-form";
import { effectiveMandatorySigningPolicy, parseMandatorySigningPolicyVersions } from "@/domains/billing/signing-mandatory-policy";
import { businessDateKey } from "@/lib/business-date";
import { getEffectiveSetupTaxTreatment } from "@/domains/billing/setup-tax-policy-version";
import { AppliancePricingTable } from "./appliance-pricing-table";
import { PackageTable } from "./package-table";
import { listPackagesForSettings } from "@/domains/packages";
import { TeamSection } from "./team-section";
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
import { twoFactorRolesFromSetting } from "@/domains/security/two-factor";
import { updateSecondStepSettingsAction, updateTwoFactorRequiredRolesAction } from "./actions";
import { getMethodSettings, twilioKeysPresent } from "@/domains/security/second-step";
import { EMAIL_WEAKER_WARNING, METHOD_LABEL } from "@/domains/security/second-step-rules";
import { listOwnSessions } from "@/domains/security/sessions";
import { SessionControls } from "./session-controls";
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
  const spanishReview = section === "notifications" ? await getSpanishReview() : null;
  const spanishDrafts = section === "notifications" ? await listCurrentTranslationDrafts() : [];
  const activeSetupTaxTreatment = section === "policies"
    ? await getEffectiveSetupTaxTreatment() : "UNDECIDED";
  const upcomingSetupPolicies = section === "policies"
    ? await prisma.setupFeeTaxDecisionVersion.findMany({
      where: { effectiveFromKey: { gt: businessDateKey(new Date()) },
        cancelledAt: null },
      orderBy: [{ effectiveFromKey: "asc" }, { ownerApprovedAt: "desc" }], take: 10,
      select: { id: true, effectiveFromKey: true, treatment: true },
    }) : [];

  const leadScoringPolicy = section === "policies" ? await getLeadScoringPolicy() : null;
  let content: React.ReactNode;
  if (section === "products") {
    const [applianceTypes, packages] = await Promise.all([getAllApplianceTypes(), listPackagesForSettings()]);
    content = (
      <>
      <Card
        title="Sets and packages"
        description="Machines rented together for one lower monthly price, such as a washer and a dryer."
        className="mb-6"
      >
        <PackageTable
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            monthlyPriceCents: p.monthlyPriceCents,
            showOnWebsite: p.showOnWebsite,
            isActive: p.isActive,
            components: p.components.map((c) => ({
              applianceTypeId: c.applianceTypeId,
              name: c.applianceType.name,
              quantity: c.quantity,
              monthlyPriceCents: c.applianceType.monthlyPriceCents,
              isActive: c.applianceType.isActive,
            })),
          }))}
          types={applianceTypes
            .filter((t) => t.isActive)
            .map((t) => ({ id: t.id, name: t.name, monthlyPriceCents: t.monthlyPriceCents }))}
        />
      </Card>
      <Card title="New-order setup and down payments"
        description="Configure future signing charges; live collection remains gated.">
        <SigningChargeForm editable={session.user.role === "OWNER"}
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
      </Card>
      <Card title="Mandatory fees on complete estimates" description="Owner-only effective-dated rule revisions; charge collection stays disabled until independent clearance.">
        <MandatorySigningPolicyForm editable={session.user.role === "OWNER"} effectiveDate={businessDateKey(new Date())}
          current={effectiveMandatorySigningPolicy(settings.signingMandatoryPolicyVersions)}
          history={parseMandatorySigningPolicyVersions(settings.signingMandatoryPolicyVersions)} />
      </Card>
      <Card
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
      </Card>
      </>
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
      <Card
        title="Ending and renewing rentals"
        description="Set the rules here whenever you like. Agreements already signed keep working; new quotes use what is saved."
      >
        <ul className="mb-6 space-y-1 rounded-card bg-subtle p-3 text-sm text-ink-soft">
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
      </Card>
    );
  } else if (section === "pickups") {
    content = (
      <Card
        title="Pickups and deliveries"
        description="What a customer is charged when an appliance comes back late, credited when one is delivered late, and whether the pickup day counts."
      >
        <PickupBillingForm defaultValues={pickupBillingDefaults(pickupBillingSettingsFrom(settings))} />
        <p className="mt-4 text-sm">
          <ButtonLink href="/desk/settings/rental-endings" variant="secondary">Rental ending reminder (days before a rental ends)</ButtonLink>
        </p>
      </Card>
    );
  } else if (section === "jobs") {
    content = (
      <Card
        title="Visits and scheduling"
        description="How long a visit is assumed to take when checking whether the same person is booked twice."
      >
        <JobSchedulingForm defaultValues={jobSchedulingDefaults(settings)} />
      </Card>
    );
  } else if (section === "staff") {
    const [team, teamSettings] = await Promise.all([getTeam(), getTeamSettings()]);
    content = (
      <Card title="Team">
        <TeamSection
          viewerRole={session.user.role === "OWNER" ? "OWNER" : "ADMIN"}
          viewerId={session.user.id}
          settings={teamSettings}
          members={team.members.map((m) => ({ ...m, lastSignIn: m.lastSignIn ? m.lastSignIn.toISOString() : null }))}
          invitations={team.invitations.map((i) => ({ id: i.id, name: i.name, email: i.email, accessLevel: i.accessLevel, state: i.state, expiresAt: i.expiresAt.toISOString() }))}
        />
      </Card>
    );
  } else if (section === "website") {
    content = (
      <Card
        title="Website controls"
        description="The public site uses your saved business profile, service area and catalog pricing."
      >
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/desk/settings/website" variant="secondary">
            Edit the website
          </ButtonLink>
          <ButtonLink href="/desk/launch" variant="secondary">
            Launch signup and announcement controls
          </ButtonLink>
          <ButtonLink
            href="/"
            variant="secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            View public website
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Use Edit the website for the wording on your pages. Use Business
          profile, Service area, and Products and pricing for contact details,
          where you work and prices.
        </p>
      </Card>
    );
  } else if (section === "security") {
    const requiredRoles = twoFactorRolesFromSetting(settings.twoFactorRequiredRoles);
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { twoFactorEnabled: true },
    });
    const canChange = session.user.role === "OWNER";
    const ownSessions = await listOwnSessions(session.user.id, session.session.token);
    const methodSettings = await getMethodSettings();
    content = (
      <Card
        title="Security"
        description="Require an authenticator-app code after the password for people who can reach sensitive business data."
      >
        <div className="mb-6 rounded-card border border-line bg-subtle p-4">
          <p className="font-medium text-ink">Your two-step login</p>
          <p className="mt-1 text-sm text-ink-soft">
            {currentUser?.twoFactorEnabled
              ? "Authenticator setup is complete."
              : "Authenticator setup is not complete yet."}
          </p>
          <div className="mt-3">
            <ButtonLink href="/desk/security/setup" variant="secondary">
              {currentUser?.twoFactorEnabled ? "Review setup" : "Set up authenticator"}
            </ButtonLink>
          </div>
        </div>
        <form action={updateTwoFactorRequiredRolesAction} className="space-y-4">
          <fieldset disabled={!canChange} className="space-y-3">
            <legend className="font-medium text-ink">Roles that must use two-step login</legend>
            <p className="text-sm text-ink-soft">
              Anyone in these roles must enter a 6-digit code from an authenticator app after their password.
              Recommended: Owner and Admin, because they can refund money and see every customer.
            </p>
            {(["OWNER", "ADMIN", "STAFF"] as const).map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="role"
                  value={role}
                  defaultChecked={requiredRoles.includes(role)}
                  className="h-4 w-4"
                />
                {role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : "Staff"}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!canChange}
              className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
            >
              Save security policy
            </button>
            <button
              type="submit"
              name="restoreRecommended"
              value="1"
              disabled={!canChange}
              className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              Restore recommended
            </button>
          </div>
          {!canChange && (
            <p className="text-sm text-ink-soft">Only the Owner can change which roles are required.</p>
          )}
          <p className="text-xs text-ink-soft">Customer accounts can never be required by this setting.</p>
        </form>
        <form action={updateSecondStepSettingsAction} className="mt-8 space-y-4 border-t border-line pt-6">
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
        <SessionControls
          sessions={ownSessions.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            lastActiveAt: row.lastActiveAt.toISOString(),
          }))}
        />
      </Card>
    );
  } else if (section === "notifications" || section === "integrations") {
    const status = providerStatus();
    content = (
      <>
      <Card
        title={
          section === "notifications"
            ? "Notification configuration"
            : "Connected services"
        }
        description="Configuration is shown separately from verified delivery. No credentials are displayed."
      >
        {section === "notifications" && (
          <div className="mb-6 rounded-card border border-line p-4">
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
        <div className="mt-3">
          <ButtonLink href="/desk/launch" variant="secondary">
            Open launch email controls
          </ButtonLink>
        </div>
      </Card>
      {section === "notifications" && spanishDrafts.length > 0 && (
        <Card title="Draft translations" description="Spanish copy alongside English source">
          <SpanishDraftsEditor sources={spanishDrafts} />
        </Card>
      )}
      {section === "notifications" && spanishReview && (
        <Card title="Spanish customer language: independently reviewed activation"
          description="Owner-only review evidence. Spanish defaults off until the current copy and controlling-English legal text are verified.">
          <SpanishReviewForm surfacesReady={allSpanishSurfacesReady} digest={spanishReview.currentDigest}
            currentReview={spanishReview.currentReview}
            reviewedAt={spanishReview.reviewedAt?.toISOString() ?? null}
            legalReviewedAt={spanishReview.legalReviewedAt?.toISOString() ?? null}
            publishedAt={spanishReview.publishedAt?.toISOString() ?? null}
            reviewerName={spanishReview.reviewerName} />
        </Card>
      )}
      {section === "notifications" && <div className="mb-4 flex flex-wrap gap-3"><ButtonLink href="/desk/settings/telecom" variant="secondary">Phone, SMS and provider costs</ButtonLink><ButtonLink href="/desk/settings/payment-links" variant="secondary">Payment link wording</ButtonLink><ButtonLink href="/desk/settings/lead-response" variant="secondary">Lead response time</ButtonLink><ButtonLink href="/desk/settings/unsigned-follow-up" variant="secondary">Unsigned agreement reminder</ButtonLink></div>}
      {section === "notifications" && <SmsTemplatePreview />}
    </>);
  } else {
    content = (
      <Card
        title={SETTINGS_SECTIONS.find((s) => s.id === section)!.label}
        description="Save only this section. Prices, staff accounts and other sections are preserved."
      >
        {section === "policies" && leadScoringPolicy && (
          <LeadScoringForm policy={leadScoringPolicy} />
        )}
        {section === "policies" && (
          <div className="mb-4 rounded-card border border-line bg-subtle p-4">
            <p className="text-sm text-ink-soft">
              The return inspection checklist is versioned separately so changing it never rewrites an inspection that
              already happened.
            </p>
            <div className="mt-3">
              <ButtonLink href="/desk/settings/policies" variant="secondary">
                Edit return inspection checklist
              </ButtonLink>
            </div>
          </div>
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
            deliveryFeeDollars: centsAsDollars(settings.oneTimeDeliveryFeeCents),
            installationFeeDollars: centsAsDollars(settings.oneTimeInstallationFeeCents),
            removalFeeDollars: centsAsDollars(settings.oneTimeRemovalFeeCents),
            damageWaiverEnabled: settings.damageWaiverEnabled,
            depositEnabled: settings.depositEnabled,
            lateFeeGraceDays: settings.lateFeeGraceDays,
            lateFeeFlatDollars: centsAsDollars(settings.lateFeeFlatCents),
            lateFeePercent: settings.lateFeePercent,
            sixMonthPrepaySetDollars:
              centsAsDollars(settings.sixMonthPrepayDiscountSetCents),
            sixMonthPrepaySingleDollars:
              centsAsDollars(settings.sixMonthPrepayDiscountSingleCents),
            twelveMonthPrepaySetDollars:
              centsAsDollars(settings.twelveMonthPrepayDiscountSetCents),
            twelveMonthPrepaySingleDollars:
              centsAsDollars(settings.twelveMonthPrepayDiscountSingleCents),
            twelveMonthPrepayFreeMonthEnabled:
              settings.twelveMonthPrepayFreeMonthEnabled,
            referralRewardDollars: centsAsDollars(settings.referralRewardCents),
            draftReservationHoldDays: settings.draftReservationHoldDays,
          }}
        />
      </Card>
    );
  }
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Settings"
        description="Manage the business one section at a time."
        secondaryActions={
          <ButtonLink href="/desk/activity" variant="secondary">
            View change history
          </ButtonLink>
        }
      />
      <div className="mb-3 flex flex-wrap gap-3">
        <ButtonLink href="/desk/control-center" variant="secondary">Manage my business</ButtonLink>
        <ButtonLink href="/desk/settings/history" variant="secondary">Settings history and undo</ButtonLink>
        <ButtonLink href="/desk/settings/switches" variant="secondary">All switches in one place</ButtonLink>
        <ButtonLink href="/desk/settings/price-changes" variant="secondary">Price changes with a start date</ButtonLink>
        {session.user.role === "OWNER" && <ButtonLink href="/desk/settings/permissions" variant="secondary">What each admin may do</ButtonLink>}
        <ButtonLink href="/desk/settings/goals" variant="secondary">Goals and alerts</ButtonLink>
        {session.user.role === "OWNER" && <ButtonLink href="/desk/settings/approvals" variant="secondary">Approval limits</ButtonLink>}
        {session.user.role === "OWNER" && <ButtonLink href="/desk/approvals" variant="secondary">Approvals waiting</ButtonLink>}
      </div>
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
