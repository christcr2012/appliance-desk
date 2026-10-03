import { prisma } from "@/lib/prisma";
import { cache } from "react";
import { assertActiveTeamActor } from "@/lib/team-actor";

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
  damageWaiverEnabled: false,
  depositEnabled: false,
  lateFeeGraceDays: 5,
  lateFeeFlatCents: 0,
  lateFeePercent: 0,
  taxRateMilliPercent: 0,
  taxRateConfirmed: false,
  announcementBannerText: null as string | null,
  announcementBannerOn: false,
  sixMonthPrepayDiscountSetCents: 500,
  sixMonthPrepayDiscountSingleCents: 250,
  twelveMonthPrepayDiscountSetCents: 1000,
  twelveMonthPrepayDiscountSingleCents: 500,
  twelveMonthPrepayFreeMonthEnabled: true,
  referralRewardCents: 2500,
  draftReservationHoldDays: 7,
  customerEmailEnabled: false,
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
  oneTimeDeliveryFeeCents: number;
  oneTimeInstallationFeeCents: number;
  oneTimeRemovalFeeCents: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  lateFeeGraceDays: number;
  lateFeeFlatCents: number;
  lateFeePercent: number;
  taxRateMilliPercent: number;
  taxRateConfirmed: boolean;
  announcementBannerText: string | null;
  announcementBannerOn: boolean;
  sixMonthPrepayDiscountSetCents: number;
  sixMonthPrepayDiscountSingleCents: number;
  twelveMonthPrepayDiscountSetCents: number;
  twelveMonthPrepayDiscountSingleCents: number;
  twelveMonthPrepayFreeMonthEnabled: boolean;
  referralRewardCents: number;
  draftReservationHoldDays: number;
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
) {
  const after = await prisma.$transaction(async (tx) => {
    // Re-check the person inside the transaction (a deactivated owner/admin
    // must not slip a change in after the page-level role check), then lock
    // the settings row so two saves cannot interleave.
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const before =
      (await tx.businessSettings.findUnique({ where: { id: "singleton" } })) ??
      DEFAULT_SETTINGS;
    const after = await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...update },
      update,
    });

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
  const applianceType = await prisma.applianceType.findUniqueOrThrow({
    where: { id: applianceTypeId },
  });
  const oldPriceCents = applianceType.monthlyPriceCents;

  const [updated] = await prisma.$transaction([
    prisma.applianceType.update({
      where: { id: applianceTypeId },
      data: { monthlyPriceCents: newPriceCents },
    }),
    prisma.pricingRule.create({
      data: {
        applianceTypeId,
        label: `${applianceType.name} — monthly price`,
        monthlyPriceCents: newPriceCents,
        changedBy: userId,
        oldValueCents: oldPriceCents,
        newValueCents: newPriceCents,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId,
        action: "pricing.update",
        entityType: "ApplianceType",
        entityId: applianceTypeId,
        oldValue: { monthlyPriceCents: oldPriceCents },
        newValue: { monthlyPriceCents: newPriceCents },
      },
    }),
  ]);

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

  const updated = await prisma.applianceType.update({
    where: { id: applianceTypeId },
    data: { photoUrl: normalized },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "appliance.photo",
      entityType: "ApplianceType",
      entityId: applianceTypeId,
      newValue: { photoUrl: normalized },
    },
  });

  return updated;
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
