import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { RuleMissingError, ruleAsOf } from "@/domains/rules/reads";
import type { ComplianceFiling } from "@prisma/client";

/**
 * CMP-4: the Weld County business personal property snapshot. The county
 * taxes what the business owned on January 1; the app builds that day's
 * picture from its own records — the book assets (the rental fleet; the
 * truck is never a book asset, so vehicles are excluded by construction)
 * and the rental assignment in force that day for the lessor columns of
 * DS 060. Nothing is estimated: the exemption check compares the total
 * ORIGINAL cost with the dated rule (the assessor works out actual value
 * from cost and year on their own schedules), and the filing says so.
 */

export interface BppItem {
  assetNumber: string;
  description: string;
  serialNumber: string | null;
  category: string;
  yearAcquired: number;
  /**
   * "Mar 2026" — the DS forms' month/year acquired-and-in-service
   * columns, from the purchase date when one is recorded (the book
   * in-service date can be a books-start clamp, not the real date).
   */
  placedInService: string;
  costCents: number;
  /** Over the $350 per-item listing line for a first-time filer. */
  over350: boolean;
  rentedOut: boolean;
  userName: string | null;
  userAddress: string | null;
  rentLineLabel: string | null;
  rentLineMonthlyCents: number | null;
  /** Snapshot items sharing this item's rental line, itself included. */
  unitsOnLine: number;
  /**
   * The monthly rent for this unit alone — set only when the unit is its
   * rental line's only appliance. A set's rent is never split by
   * invention; the line's label and whole price ride along instead.
   */
  monthlyRentCents: number | null;
}

export interface BppSnapshot {
  year: number;
  asOf: string; // `${year}-01-01`
  items: BppItem[];
  totalCostCents: number;
  over350Count: number;
  firstTimeFiler: boolean;
  thresholdCents: number | null;
  /** UNDER = at or under the exemption (no declaration); UNKNOWN = the rule book has no threshold, so no verdict is offered. */
  verdict: "UNDER" | "OVER" | "UNKNOWN";
  extension: { tenDayFeeCents: number; twentyDayFeeCents: number } | null;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const BPP_ITEM_LISTING_LINE_CENTS = 35000; // $350, the first-time filer's per-item listing line (DS 056 instructions).

async function ruleOrNull<T>(key: "co.bpp.exemption_threshold" | "co.bpp.extension", at: Date): Promise<T | null> {
  try {
    const { value } = await ruleAsOf<T>(key, at);
    return value;
  } catch (error) {
    if (error instanceof RuleMissingError) return null;
    throw error;
  }
}

/** The January 1 snapshot for a declaration year, from the live records. */
export async function computeBppSnapshot(year: number): Promise<BppSnapshot> {
  const asOf = `${year}-01-01`;
  const jan1 = businessDateFromKey(asOf);
  if (!jan1) throw new Error(`Bad declaration year: ${year}`);

  const assets = await prisma.bookAsset.findMany({
    include: { appliance: { include: { applianceType: true } } },
  });
  // Ownership is read off the purchase date, NOT the book in-service
  // date: Books deliberately clamps placedInServiceOn to the books
  // start date for depreciation (books/autopilot), so a unit bought
  // before the books opened would vanish from its first declaration
  // and be mis-dated. The purchase date is the ownership evidence;
  // the book date is only the fallback when no purchase was recorded.
  const ownershipDate = (asset: (typeof assets)[number]) =>
    asset.appliance.purchaseDate ?? asset.placedInServiceOn;
  const owned = assets.filter((asset) => {
    if (businessDateKey(ownershipDate(asset)) > asOf) return false;
    if (asset.disposedOn && businessDateKey(asset.disposedOn) <= asOf) return false;
    return true;
  });

  // The assignment in force on January 1, for the rented-out units.
  const applianceIds = owned.map((asset) => asset.applianceId);
  const assignments = applianceIds.length
    ? await prisma.applianceAssignment.findMany({
        where: { applianceId: { in: applianceIds } },
        include: {
          rentalLine: {
            include: {
              agreement: { include: { customer: { include: { user: true } }, serviceAddress: true } },
            },
          },
        },
        orderBy: { assignedAt: "asc" },
      })
    : [];
  const inForce = new Map<string, (typeof assignments)[number]>();
  for (const assignment of assignments) {
    if (businessDateKey(assignment.assignedAt) > asOf) continue;
    if (assignment.unassignedAt && businessDateKey(assignment.unassignedAt) <= asOf) continue;
    inForce.set(assignment.applianceId, assignment); // ascending order: the latest in-force wins
  }
  const unitsPerLine = new Map<string, number>();
  for (const assignment of inForce.values()) {
    unitsPerLine.set(assignment.rentalLineId, (unitsPerLine.get(assignment.rentalLineId) ?? 0) + 1);
  }

  const items: BppItem[] = owned
    .map((asset) => {
      const appliance = asset.appliance;
      const assignment = inForce.get(asset.applianceId);
      const placed = businessDateKey(ownershipDate(asset));
      const [placedYear, placedMonth] = placed.split("-").map(Number);
      const description = [
        appliance.applianceType.name,
        appliance.manufacturer,
        appliance.model,
      ]
        .filter(Boolean)
        .join(" — ");
      let userName: string | null = null;
      let userAddress: string | null = null;
      if (assignment) {
        const agreement = assignment.rentalLine.agreement;
        userName = agreement.customer.user.name ?? agreement.customer.user.email;
        const address = agreement.serviceAddress;
        userAddress = [address.line1, address.line2, `${address.city}, ${address.state} ${address.zip}`]
          .filter(Boolean)
          .join(", ");
      }
      const unitsOnLine = assignment ? (unitsPerLine.get(assignment.rentalLineId) ?? 1) : 0;
      return {
        assetNumber: appliance.assetNumber,
        description,
        serialNumber: appliance.serialNumber,
        category: "Rental appliances",
        yearAcquired: placedYear,
        placedInService: `${MONTHS_SHORT[placedMonth - 1]} ${placedYear}`,
        costCents: asset.costCents,
        over350: asset.costCents > BPP_ITEM_LISTING_LINE_CENTS,
        rentedOut: Boolean(assignment),
        userName,
        userAddress,
        rentLineLabel: assignment?.rentalLine.label ?? null,
        rentLineMonthlyCents: assignment?.rentalLine.monthlyPriceCents ?? null,
        unitsOnLine,
        monthlyRentCents:
          assignment && unitsOnLine === 1 ? assignment.rentalLine.monthlyPriceCents : null,
      };
    })
    .sort((a, b) => a.assetNumber.localeCompare(b.assetNumber));

  const earlierSubmitted = await prisma.complianceFiling.count({
    where: {
      obligationKey: "co.bpp.weld_declaration",
      state: { in: ["SUBMITTED", "ACCEPTED"] },
      periodKey: { lt: `${year}` },
    },
  });

  const thresholdCents = await ruleOrNull<number>("co.bpp.exemption_threshold", jan1);
  const extension = await ruleOrNull<{ tenDayFeeCents: number; twentyDayFeeCents: number }>(
    "co.bpp.extension",
    jan1,
  );
  const totalCostCents = items.reduce((sum, item) => sum + item.costCents, 0);
  return {
    year,
    asOf,
    items,
    totalCostCents,
    over350Count: items.filter((item) => item.over350).length,
    firstTimeFiler: earlierSubmitted === 0,
    thresholdCents,
    verdict: thresholdCents === null ? "UNKNOWN" : totalCostCents <= thresholdCents ? "UNDER" : "OVER",
    extension,
  };
}

/** The prepared data the BPP filing carries (snapshot + the business identity the forms print). */
export async function buildBppPreparedData(
  filing: ComplianceFiling,
  profile: {
    businessLegalName: string | null;
    businessAddress: string | null;
    businessCity: string | null;
    businessState: string | null;
    businessZip: string | null;
    businessPhone: string | null;
  },
): Promise<Record<string, unknown>> {
  const year = Number(filing.periodKey);
  if (!Number.isInteger(year)) throw new Error("That filing's year could not be read.");
  const snapshot = await computeBppSnapshot(year);
  return {
    year,
    what:
      "Weld County business personal property declaration for the property you owned on January 1. Check the snapshot, then file the filled forms or the spreadsheet with the Weld County Assessor by April 15.",
    snapshot,
    business: {
      legalName: profile.businessLegalName,
      address: profile.businessAddress,
      city: profile.businessCity,
      state: profile.businessState,
      zip: profile.businessZip,
      phone: profile.businessPhone,
    },
  };
}

/** The snapshot shape the downloads and the filing page read back from preparedData. */
export function bppSnapshotFromPrepared(preparedData: unknown): BppSnapshot | null {
  if (!preparedData || typeof preparedData !== "object") return null;
  const snapshot = (preparedData as { snapshot?: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidate = snapshot as BppSnapshot;
  if (!Array.isArray(candidate.items) || typeof candidate.totalCostCents !== "number") return null;
  return candidate;
}

export function bppBusinessFromPrepared(
  preparedData: unknown,
): { legalName: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null } | null {
  if (!preparedData || typeof preparedData !== "object") return null;
  const business = (preparedData as { business?: unknown }).business;
  if (!business || typeof business !== "object") return null;
  return business as {
    legalName: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
  };
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const dollars = (cents: number): string => (cents / 100).toFixed(2);

/** The itemized listing for the Weld Declaration System, from the approved snapshot. */
export function bppSpreadsheetCsv(snapshot: BppSnapshot): string {
  const lines = [
    [
      "Item ID",
      "Quantity",
      "Description (incl. model and serial number)",
      "Year acquired",
      "Original cost ($)",
      "First placed in service",
      "Rented out on Jan 1",
      "Name and address of user",
      "Monthly rent ($)",
      "Rental line",
    ].join(","),
  ];
  for (const item of snapshot.items) {
    lines.push(
      [
        csvCell(item.assetNumber),
        csvCell(1),
        csvCell(item.serialNumber ? `${item.description} — serial ${item.serialNumber}` : item.description),
        csvCell(item.yearAcquired),
        csvCell(dollars(item.costCents)),
        csvCell(item.placedInService),
        csvCell(item.rentedOut ? "Yes" : "No"),
        csvCell(item.userName ? `${item.userName}, ${item.userAddress ?? ""}` : ""),
        csvCell(item.monthlyRentCents !== null ? dollars(item.monthlyRentCents) : ""),
        csvCell(item.rentLineLabel ?? ""),
      ].join(","),
    );
  }
  lines.push(
    ["", "", csvCell(`Total original cost, ${snapshot.items.length} item${snapshot.items.length === 1 ? "" : "s"}`), "", csvCell(dollars(snapshot.totalCostCents)), "", "", "", "", ""].join(","),
  );
  return lines.join("\n") + "\n";
}
