import { prisma } from "@/lib/prisma";
import { cache } from "react";

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
  oneTimeRemovalFeeCents: 0,
  damageWaiverEnabled: false,
  depositEnabled: false,
  lateFeeGraceDays: 5,
  lateFeeFlatCents: 0,
  lateFeePercent: 0,
  taxRatePermille: 0,
  taxRateConfirmed: false,
  announcementBannerText: null as string | null,
  announcementBannerOn: false,
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

export type BusinessHours = Record<string, string>;

export function parseHours(settings: { hours: unknown }): BusinessHours {
  if (
    settings.hours &&
    typeof settings.hours === "object" &&
    !Array.isArray(settings.hours)
  ) {
    return settings.hours as BusinessHours;
  }
  return {};
}

/** Formats a signed cents amount as a plain-English rate, e.g. "no charge yet". */
export function formatPercentFromPermille(permille: number): string {
  return `${(permille / 10).toFixed(1)}%`;
}

export type BusinessSettingsUpdate = Partial<{
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
  serviceAreaCities: string[];
  serviceAreaZips: string[];
  oneTimeDeliveryFeeCents: number;
  oneTimeRemovalFeeCents: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  lateFeeGraceDays: number;
  lateFeeFlatCents: number;
  lateFeePercent: number;
  taxRatePermille: number;
  taxRateConfirmed: boolean;
  announcementBannerText: string | null;
  announcementBannerOn: boolean;
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
  const before = await getBusinessSettings();

  const after = await prisma.businessSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...update },
    update,
  });

  await prisma.auditLog.create({
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

export async function getAllApplianceTypes() {
  return prisma.applianceType.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
