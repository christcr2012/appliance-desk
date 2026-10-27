import { looksRefrigerated } from "@/domains/refrigerant/rules";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { assertCapability } from "@/domains/capabilities";
import { assetIdFromPublicPath } from "@/domains/site-content/asset-paths";
import { checkExternalUrl } from "@/domains/site-content/links";
import { SettingsConflictError } from "./effects";
import { sectionRevision } from "./preview";
import type { EditableSettingsSection } from "./section-config";

// The single BusinessSettings row's defaults, matching prisma/schema.prisma
// exactly. Used only if the singleton row is somehow missing (it's created
// by prisma/seed.ts), so a page render never has to write to the database
// just to read settings.
const DEFAULT_SETTINGS = {
  id: "singleton",
  publicBusinessName: "[Company Name]",
  publicPhone: "[Phone Number]",
  publicEmail: "[Email Address]",
  publicAddress: "[Business Address]",
  serviceAreaCities: [] as unknown,
  serviceAreaZips: [] as unknown,
  hours: {} as unknown,
  holidayClosures: [] as unknown,
  socialLinks: {} as unknown,
  logoUrl: null as string | null,
  oneTimeDeliveryFeeCents: 0,
  oneTimeInstallationFeeCents: 0,
  oneTimeRemovalFeeCents: 0,
  administrativeSetupFeeCents: 4500,
  largeOrderMachineThreshold: 5,
  largeOrderCancellationFullRefundHours: 72,
  businessRequiresDownPayment: true,
  setupFeeTaxTreatment: "UNDECIDED",
  setupFeeTaxDecisionNote: null as string | null,
  setupFeeTaxPlanningTreatment: "TAXABLE",
  setupFeeTaxConfirmedOn: null as Date | null,
  setupFeeTaxEffectiveFrom: null as Date | null,
  setupFeeTaxApprovedAt: null as Date | null,
  setupFeeTaxAdviserReference: null as string | null,
  signingMandatoryPolicyVersions: [] as unknown,
  damageWaiverEnabled: false,
  depositEnabled: false,
  lateFeeGraceDays: 10,
  lateFeeNoticeDaysBefore: 2,
  ucccNotificationFiledOn: null as Date | null,
  bankPaymentSlowBusinessDays: 6,
  lateFeeFlatCents: 0,
  lateFeePercent: 0,
  announcementBannerText: null as string | null,
  announcementBannerOn: false,
  sixMonthPrepayDiscountSetCents: 500,
  sixMonthPrepayDiscountSingleCents: 250,
  twelveMonthPrepayDiscountSetCents: 1000,
  twelveMonthPrepayDiscountSingleCents: 500,
  twelveMonthPrepayFreeMonthEnabled: true,
  referralRewardCents: 2500,
  draftReservationHoldDays: 7,
  receiptFileKeepDays: 30,
  unsentPhotoKeepDays: 1,
  customerEmailEnabled: false,
  twoFactorRequiredRoles: ["OWNER", "ADMIN"] as unknown,
  autoRenewEnabled: false,
  inspectionChecklist: [] as unknown,
  // Batch B policy fields: null means the owner has not decided yet.
  earlyTerminationFeeCents: null as number | null,
  earlyTerminationFeePercent: null as number | null,
  earlyTerminationFeeCapCents: null as number | null,
  earlyTerminationNoticeDays: null as number | null,
  unusedTermTreatment: null as string | null,
  autoRenewNoticeDays: null as number | null,
  autoRenewTermsVersion: null as string | null,
  renewalTermsText: null as string | null,
  terminationTermsText: null as string | null,
  // Pickup and return billing (IN-24 / IN-26 / IN-27): the recommended starting values.
  lateReturnRateMode: "MONTHLY_DIV_30",
  lateReturnFixedDailyCents: 0,
  lateDeliveryProrationBasis: "MONTHLY_DIV_30",
  earlyReturnProrationBasis: "MONTHLY_DIV_30", // read again by "When equipment comes back early" (B2-19)
  earlyReturnBilling: "KEEP_TO_AGREED_END",
  earlyReturnUnusedDays: "KEEP",
  earlyReturnFee: "AGREED_TERMS_FEE",
  earlyReturnHandling: "ASK_ME",
  pickupDayNotBilled: true,
  outOfServiceEscalationDays: 3,
  defaultJobDurationMinutes: 120,
  staffMayWorkUnassignedJobs: true,
  updatedAt: new Date(0),
};

/**
 * BusinessSettings is a singleton row (id: "singleton") — see
 * prisma/schema.prisma. This is the one place the public site, the lead
 * form, and the owner desk all read business info, fees, and service area
 * from, per docs/BUSINESS-RULES.md ("every price lives in the database").
 *
 * cache() de-dupes repeated calls within a single request (e.g. header +
 * footer + page all reading settings on the same render). This only
 * reads — the row is created once by prisma/seed.ts, never on a page
 * render, so visiting the public site never triggers a database write.
 */
export const getBusinessSettings = cache(async () => {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
  });
  return settings ?? DEFAULT_SETTINGS;
});

export type ServiceArea = {
  cities: string[];
  zips: string[];
};

export function parseServiceArea(settings: {
  serviceAreaCities: unknown;
  serviceAreaZips: unknown;
}): ServiceArea {
  const cities = Array.isArray(settings.serviceAreaCities)
    ? (settings.serviceAreaCities as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  const zips = Array.isArray(settings.serviceAreaZips)
    ? (settings.serviceAreaZips as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  return { cities, zips };
}

export type BusinessSettingsUpdate = Partial<{
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
  serviceAreaCities: string[];
  serviceAreaZips: string[];
  // Opening hours, holiday closures, social links and logo (Batch D, D2); shapes are in ./profile-extras.
  hours: Prisma.InputJsonObject;
  holidayClosures: Prisma.InputJsonArray;
  socialLinks: Prisma.InputJsonObject;
  logoUrl: string | null;
  oneTimeDeliveryFeeCents: number;
  oneTimeInstallationFeeCents: number;
  oneTimeRemovalFeeCents: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  lateFeeGraceDays: number;
  lateFeeNoticeDaysBefore: number;
  ucccNotificationFiledOn: Date | null;
  lateFeeFlatCents: number;
  lateFeePercent: number;
  announcementBannerText: string | null;
  announcementBannerOn: boolean;
  sixMonthPrepayDiscountSetCents: number;
  sixMonthPrepayDiscountSingleCents: number;
  twelveMonthPrepayDiscountSetCents: number;
  twelveMonthPrepayDiscountSingleCents: number;
  twelveMonthPrepayFreeMonthEnabled: boolean;
  referralRewardCents: number;
  draftReservationHoldDays: number;
  receiptFileKeepDays: number;
  unsentPhotoKeepDays: number;
  // Rental ending and renewal policy (null = not decided yet).
  earlyTerminationFeeCents: number | null;
  earlyTerminationFeePercent: number | null;
  earlyTerminationFeeCapCents: number | null;
  earlyTerminationNoticeDays: number | null;
  unusedTermTreatment: string | null;
  terminationTermsText: string | null;
  autoRenewNoticeDays: number | null;
  autoRenewTermsVersion: string | null;
  renewalTermsText: string | null;
  // Pickup and return billing (IN-24 / IN-26 / IN-27).
  lateReturnRateMode: string;
  lateReturnFixedDailyCents: number;
  lateDeliveryProrationBasis: string;
  pickupDayNotBilled: boolean;
  outOfServiceEscalationDays: number;
  // When equipment comes back early (B2-19).
  earlyReturnBilling: string;
  earlyReturnUnusedDays: string;
  earlyReturnFee: string;
  earlyReturnHandling: string;
  earlyReturnProrationBasis: string;
  // Visits and scheduling (Batch C P1-A).
  defaultJobDurationMinutes: number;
  staffMayWorkUnassignedJobs: boolean;
}>;

/**
 * Updates the BusinessSettings singleton and writes an AuditLog entry
 * recording who changed what, per docs/BUSINESS-RULES.md ("every pricing
 * change is logged... visible in /desk/activity"). Only OWNER/ADMIN can
 * reach this — enforced by the caller (the /desk/settings server action)
 * via requireRole, same pattern as every other desk mutation.
 */
export async function updateBusinessSettings(
  userId: string,
  update: BusinessSettingsUpdate,
  opts?: {
    /** Fingerprint of the fields this save covers, taken when the page was opened (see `sectionRevision`). */
    expectedRevision?: { section: EditableSettingsSection; value: string };
  },
) {
  return prisma.$transaction((tx) => updateBusinessSettingsInTx(tx, userId, update, opts));
}

/**
 * The settings save inside a transaction the caller owns (Decisions & reviews runs its record and the save together).
 * Same checks, lock, conflict rule and audit as `updateBusinessSettings`; locking the row again inside the same
 * transaction is fine (Postgres row locks are re-entrant within one transaction).
 */
export async function updateBusinessSettingsInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  update: BusinessSettingsUpdate,
  opts?: {
    expectedRevision?: { section: EditableSettingsSection; value: string };
  },
) {
    // Re-check the person inside the transaction (a deactivated owner/admin
    // must not slip a change in after the page-level role check), then lock
    // the settings row so two saves cannot interleave.
    await assertCapability(tx, userId, "EDIT_SETTINGS");
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before =
      (await tx.businessSettings.findUnique({ where: { id: "singleton" } })) ??
      DEFAULT_SETTINGS;
    // A page opened before somebody else saved these same fields must not overwrite their decision.
    if (
      opts?.expectedRevision &&
      sectionRevision(before, opts.expectedRevision.section) !== opts.expectedRevision.value
    )
      throw new SettingsConflictError();
    // FEE-1: one rule for every rental. A late fee needs the bill to be more than 10 days late and is never over $15.
    if (update.lateFeeGraceDays !== undefined && update.lateFeeGraceDays < 10)
      throw new Error("Colorado's rule: a bill must be at least 10 days late before a late fee. Choose 10 or more days.");
    if (update.lateFeeFlatCents !== undefined && update.lateFeeFlatCents > 1500)
      throw new Error("A late fee can be at most $15. Choose $15 or less.");
    const after = await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...update },
      update,
    });

    // The ending notice days and wording ARE the month-to-month terms: changing them publishes the next version.
    if (
      ("earlyTerminationNoticeDays" in update || "terminationTermsText" in update) &&
      after.earlyTerminationNoticeDays !== null &&
      after.terminationTermsText?.trim()
    ) {
      const { publishMonthToMonthTermsInTx } = await import("@/domains/agreements/month-to-month");
      await publishMonthToMonthTermsInTx(tx, userId, {
        noticeDays: after.earlyTerminationNoticeDays,
        termsText: after.terminationTermsText,
      });
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.update",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: JSON.parse(JSON.stringify(before)),
        newValue: JSON.parse(JSON.stringify(after)),
      },
    });

    return after;
}

/**
 * Changes one appliance type's published monthly price. Writes a
 * PricingRule row recording the old → new value (docs/BUSINESS-RULES.md:
 * "price history is sacred" — an already-signed RentalAgreement snapshots
 * its own price at signing, so changing this never changes what an
 * existing customer owes) plus a matching AuditLog entry.
 */
export async function updateAppliancePrice(
  userId: string,
  applianceTypeId: string,
  newPriceCents: number,
) {
  return prisma.$transaction(async (tx) => {
    await assertCapability(tx, userId, "EDIT_SETTINGS");
    return updateAppliancePriceInTx(tx, userId, applianceTypeId, newPriceCents);
  });
}

/**
 * The price save itself, inside a transaction the caller owns (the caller has already checked who may do this).
 * Locks the appliance type first so two saves cannot both read the same old price. The scheduled-price nightly job
 * (Batch O-4) calls this too, so a scheduled change leaves exactly the same history and audit rows as a typed one.
 */
export async function updateAppliancePriceInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  applianceTypeId: string,
  newPriceCents: number,
  extraAudit: Record<string, string> = {},
) {
  if (!Number.isInteger(newPriceCents) || newPriceCents < 0) throw new Error("Enter a valid price.");
  await tx.$queryRaw`SELECT "id" FROM "ApplianceType" WHERE "id" = ${applianceTypeId} FOR UPDATE`;
  const applianceType = await tx.applianceType.findUniqueOrThrow({ where: { id: applianceTypeId } });
  const oldPriceCents = applianceType.monthlyPriceCents;

  const updated = await tx.applianceType.update({
    where: { id: applianceTypeId },
    data: { monthlyPriceCents: newPriceCents },
  });
  await tx.pricingRule.create({
    data: {
      applianceTypeId,
      label: `${applianceType.name} — monthly price`,
      monthlyPriceCents: newPriceCents,
      changedBy: userId,
      oldValueCents: oldPriceCents,
      newValueCents: newPriceCents,
    },
  });
  await tx.auditLog.create({
    data: {
      userId,
      action: "pricing.update",
      entityType: "ApplianceType",
      entityId: applianceTypeId,
      oldValue: { monthlyPriceCents: oldPriceCents },
      newValue: { monthlyPriceCents: newPriceCents, ...extraAudit },
    },
  });
  return updated;
}

/**
 * Sets (or clears, with null) an appliance type's real photo URL. An
 * empty string is treated the same as null — clears back to the
 * generic icon fallback (<ApplianceMedia>) rather than storing an
 * empty string that would fail to load as an image.
 */
export async function setAppliancePhotoUrl(
  userId: string,
  applianceTypeId: string,
  photoUrl: string | null,
) {
  const normalized = photoUrl && photoUrl.trim() ? photoUrl.trim() : null;
  // V-C2: only an https address, one of our own bundled pictures, or an uploaded website picture is accepted.
  const siteAssetId = normalized ? assetIdFromPublicPath(normalized) : null;
  if (normalized && !siteAssetId && !/^\/appliances\/[A-Za-z0-9._-]+$/.test(normalized) && !checkExternalUrl(normalized).ok) {
    throw new Error("Enter a full image address starting with https://, or choose an uploaded picture.");
  }

  return prisma.$transaction(async (tx) => {
    await assertCapability(tx, userId, "EDIT_SETTINGS");
    if (siteAssetId) {
      // A catalog picture is live as soon as it is saved, so an uploaded picture becomes public here.
      const asset = await tx.websiteAsset.findUnique({ where: { id: siteAssetId } });
      if (!asset || asset.state === "RETIRED") throw new Error("That uploaded picture is not available. Upload it again.");
      if (asset.state === "DRAFT") await tx.websiteAsset.update({ where: { id: siteAssetId }, data: { state: "PUBLIC", publishedAt: new Date() } });
    }
    const updated = await tx.applianceType.update({
      where: { id: applianceTypeId },
      data: { photoUrl: normalized },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "appliance.photo",
        entityType: "ApplianceType",
        entityId: applianceTypeId,
        newValue: { photoUrl: normalized },
      },
    });
    return updated;
  });
}

/** Toggles whether an appliance type appears on the public pricing page. */
export async function setApplianceVisibility(
  userId: string,
  applianceTypeId: string,
  showOnWebsite: boolean,
) {
  const updated = await prisma.applianceType.update({
    where: { id: applianceTypeId },
    data: { showOnWebsite },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "appliance.visibility",
      entityType: "ApplianceType",
      entityId: applianceTypeId,
      newValue: { showOnWebsite },
    },
  });

  return updated;
}

/** All appliance types, active and retired — used by /desk/settings, which
 * needs to show and manage both. Public-facing code should use
 * getPublishedApplianceTypes (src/domains/pricing) instead, which filters
 * to isActive && showOnWebsite. */
export async function getAllApplianceTypes() {
  return prisma.applianceType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** Turns an appliance type name into a URL/database-safe slug, e.g.
 * "Mini Fridge" → "mini-fridge". Exported for testing — see
 * tests/appliance-types.test.ts. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Creates a new appliance category (e.g. "Refrigerator", "Range") as a
 * data row — per docs/BUSINESS-RULES.md, new appliance categories are
 * always data, never a code change, so Chris can add one himself from
 * /desk/settings without waiting on a developer. Starts hidden from the
 * public site (showOnWebsite: false) so Chris can set a real price
 * before anyone sees it.
 */
export async function createApplianceType(
  userId: string,
  input: { name: string; monthlyPriceCents: number },
) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  const baseSlug = slugify(name);
  if (!baseSlug) {
    throw new Error("Name must contain at least one letter or number.");
  }

  // Slugs must be unique — if "Washer" already exists, "washer-2" etc.
  // This only matters if a retired type is later re-added under a name
  // that collides with its own old slug, or two similarly-named types.
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.applianceType.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const existingByName = await prisma.applianceType.findUnique({
    where: { name },
  });
  if (existingByName) {
    throw new Error(`An appliance type named "${name}" already exists.`);
  }

  const maxSortOrder = await prisma.applianceType.aggregate({
    _max: { sortOrder: true },
  });

  const created = await prisma.applianceType.create({
    data: {
      name,
      slug,
      monthlyPriceCents: input.monthlyPriceCents,
      showOnWebsite: false,
      hasRefrigerant: looksRefrigerated(name),
      sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "appliance.create",
      entityType: "ApplianceType",
      entityId: created.id,
      newValue: {
        name: created.name,
        monthlyPriceCents: created.monthlyPriceCents,
      },
    },
  });

  return created;
}

/**
 * Retires (or restores) an appliance type. Retiring never deletes the
 * row — existing Leads/PricingRules/Appliances that reference it must
 * keep working — it just hides it from the public site and from the
 * "active" list in /desk/settings. Retiring also force-disables
 * showOnWebsite so a retired type can never keep showing publicly.
 */
export async function setApplianceTypeActive(
  userId: string,
  applianceTypeId: string,
  isActive: boolean,
) {
  const updated = await prisma.applianceType.update({
    where: { id: applianceTypeId },
    data: isActive ? { isActive } : { isActive, showOnWebsite: false },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: isActive ? "appliance.restore" : "appliance.retire",
      entityType: "ApplianceType",
      entityId: applianceTypeId,
      newValue: { isActive },
    },
  });

  return updated;
}
