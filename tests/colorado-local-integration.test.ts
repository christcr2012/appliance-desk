import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import {
  getComplianceProfile,
  saveBusinessFacts,
  type BusinessFactsInput,
} from "@/domains/compliance/profile";
import {
  markFilingNotApplicable,
  prepareFiling,
  syncComplianceFilings,
} from "@/domains/compliance/filings";
import { buildBppPreparedData, computeBppSnapshot } from "@/domains/compliance/bpp";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const day = (s: string) => businessDateFromKey(s)!;

const emptyLocal: NonNullable<BusinessFactsInput["local"]> = {
  tradeName: null,
  usdotNumber: null,
  truckRegistrationMonth: null,
  greeleyLicenseDate: null,
  registeredAgentName: null,
  registeredAgentAddress: null,
  registeredAgentCity: null,
  registeredAgentState: null,
  registeredAgentZip: null,
};

describe.skipIf(!enabled)("CMP-4 Colorado and local filings", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let savedFacts: BusinessFactsInput;
  const typeId = `cmp4-type-${tag}`;
  const customerUserId = `cmp4-u-${tag}`;
  const customerId = `cmp4-c-${tag}`;
  const addressId = `cmp4-addr-${tag}`;
  const agreementId = `cmp4-ag-${tag}`;
  const setAgreementId = `cmp4-ag2-${tag}`;
  const appRented = `cmp4-app1-${tag}`;
  const appSet1 = `cmp4-app2-${tag}`;
  const appSet2 = `cmp4-app3-${tag}`;
  const appDisposed = `cmp4-app4-${tag}`;
  const appLater = `cmp4-app5-${tag}`;
  const appPreBooks = `cmp4-app6-${tag}`;
  const applianceIds = [appRented, appSet1, appSet2, appDisposed, appLater, appPreBooks];
  const ruleIds: string[] = [];

  function unit(id: string, assetNumber: string, manufacturer: string, model: string, serial?: string) {
    return prisma.appliance.create({
      data: { id, assetNumber, applianceTypeId: typeId, status: "RENTED", manufacturer, model, serialNumber: serial },
    });
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const profile = await getComplianceProfile();
    savedFacts = {
      entityType: profile.entityType as BusinessFactsInput["entityType"],
      employees: profile.employees,
      truckGvwrLbs: profile.truckGvwrLbs,
      sosReportMonth: profile.sosReportMonth,
      hasHomeOffice: profile.hasHomeOffice,
    };

    await prisma.applianceType.create({ data: { id: typeId, name: `CMP4 Type ${tag}`, slug: `cmp4-type-${tag}` } });
    await prisma.user.create({
      data: { id: customerUserId, email: `${customerUserId}@example.test`, role: "CUSTOMER", name: "Casey Renter" },
    });
    await prisma.customer.create({ data: { id: customerId, userId: customerUserId, referralCode: `CMP4-${tag}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "12 Oak St", city: "Greeley", state: "CO", zip: "80631" },
    });
    await prisma.rentalAgreement.create({
      data: {
        id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
        lines: { create: { label: "Washer @ $45/mo", monthlyPriceCents: 4500, listPriceCents: 4500 } },
      },
    });
    await prisma.rentalAgreement.create({
      data: {
        id: setAgreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
        lines: { create: { label: "Washer/Dryer set @ $60/mo", monthlyPriceCents: 6000, listPriceCents: 6000 } },
      },
    });
    await unit(appRented, `C4A-${tag}`, "Samsung", "WA45", "SN-C4A");
    await unit(appSet1, `C4B-${tag}`, "Samsung", "WA46");
    await unit(appSet2, `C4C-${tag}`, "Samsung", "DV46");
    await unit(appDisposed, `C4D-${tag}`, "LG", "WM22");
    await unit(appLater, `C4E-${tag}`, "LG", "DLEX");
    // Bought in December 2025, before the books opened: Books clamps
    // its in-service date to the books start (February 2026), but the
    // county cares about ownership — the purchase date rules (PR #668).
    await prisma.appliance.create({
      data: {
        id: appPreBooks, assetNumber: `C4F-${tag}`, applianceTypeId: typeId, status: "RENTED",
        manufacturer: "Samsung", model: "WA47", purchaseDate: day("2025-12-15"),
      },
    });
    const book = (applianceId: string, costCents: number, placed: string, disposed?: string) =>
      prisma.bookAsset.create({
        data: {
          applianceId, costCents, placedInServiceOn: day(placed), lifeMonths: 60, salvagePercent: 0,
          createdByUserId: ownerId, ...(disposed ? { disposedOn: day(disposed) } : {}),
        },
      });
    await book(appRented, 45000, "2026-03-01");
    await book(appSet1, 20000, "2026-04-01");
    await book(appSet2, 21000, "2026-04-01");
    await book(appDisposed, 99000, "2026-01-15", "2026-12-01");
    await book(appLater, 30000, "2027-02-01");
    await book(appPreBooks, 15000, "2026-02-01");
    const line1 = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } });
    const line2 = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId: setAgreementId } });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: line1.id, applianceId: appRented, assignedAt: new Date("2026-05-01T12:00:00Z") },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: line2.id, applianceId: appSet1, assignedAt: new Date("2026-05-01T12:00:00Z") },
    });
    await prisma.applianceAssignment.create({
      data: { rentalLineId: line2.id, applianceId: appSet2, assignedAt: new Date("2026-05-01T12:00:00Z") },
    });
  });

  afterAll(async () => {
    for (const id of ruleIds) {
      await prisma.legalRuleVersion.update({ where: { id }, data: { undoneAt: new Date() } }).catch(() => undefined);
    }
    // Restore the singleton profile's facts and re-sync so later suites
    // see the baseline filing set again.
    await saveBusinessFacts(ownerId, { ...savedFacts, local: emptyLocal }).catch(() => undefined);
    await syncComplianceFilings().catch(() => undefined);
    await prisma.complianceFiling.deleteMany({
      where: { obligationKey: { in: ["co.bpp.weld_declaration", "greeley.business_license", "co.vehicle_registration", "fed.usdot"] } },
    }).catch(() => undefined);
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.bookAsset.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: [agreementId, setAgreementId] } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: [agreementId, setAgreementId] } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: customerUserId } });
  });

  it("the January 1 snapshot counts what was owned, rented and priced — and only that", async () => {
    const snapshot = await computeBppSnapshot(2027);
    const mine = snapshot.items.filter((i) => i.assetNumber.endsWith(tag));
    expect(mine.map((i) => i.assetNumber).sort()).toEqual([`C4A-${tag}`, `C4B-${tag}`, `C4C-${tag}`, `C4F-${tag}`]);
    const preBooks = mine.find((i) => i.assetNumber === `C4F-${tag}`)!;
    expect(preBooks.yearAcquired).toBe(2025); // the purchase year, not the clamped books year
    expect(preBooks.placedInService).toBe("Dec 2025");
    const rented = mine.find((i) => i.assetNumber === `C4A-${tag}`)!;
    expect(rented.rentedOut).toBe(true);
    expect(rented.userName).toBe("Casey Renter");
    expect(rented.userAddress).toBe("12 Oak St, Greeley, CO 80631");
    expect(rented.monthlyRentCents).toBe(4500); // the line's only unit: its rent is known
    expect(rented.over350).toBe(true);
    const setUnit = mine.find((i) => i.assetNumber === `C4B-${tag}`)!;
    expect(setUnit.unitsOnLine).toBe(2);
    expect(setUnit.monthlyRentCents).toBeNull(); // a set's rent is the line's, never split by invention
    expect(setUnit.rentLineMonthlyCents).toBe(6000);
    expect(setUnit.rentedOut).toBe(true);
    // The county figure is $56,000 for 2026 and a small fleet of
    // dollar-scale test appliances sits far under it.
    expect(snapshot.thresholdCents).toBe(5600000);
    expect(snapshot.verdict).toBe("UNDER");
    expect(snapshot.firstTimeFiler).toBe(true);
    expect(snapshot.extension).toEqual({ tenDayFeeCents: 2000, twentyDayFeeCents: 4000 });
  });

  it("facts with the local block validate and land on the profile", async () => {
    await saveBusinessFacts(ownerId, {
      ...savedFacts,
      local: { ...emptyLocal, tradeName: "Robinson Rentals" },
    });
    const after = await getComplianceProfile();
    expect(after.tradeName).toBe("Robinson Rentals");
    await expect(
      saveBusinessFacts(ownerId, { ...savedFacts, local: { ...emptyLocal, truckRegistrationMonth: 13 } }),
    ).rejects.toThrow(/registration month/i);
    await expect(
      saveBusinessFacts(ownerId, { ...savedFacts, local: { ...emptyLocal, usdotNumber: "USDOT-ABC" } }),
    ).rejects.toThrow(/digits only/);
    await expect(
      saveBusinessFacts(ownerId, { ...savedFacts, local: { ...emptyLocal, greeleyLicenseDate: "2026-02-30" } }),
    ).rejects.toThrow(/Greeley license date/);
  });

  it("sync creates the Greeley, registration and USDOT filings from the recorded facts", async () => {
    await saveBusinessFacts(ownerId, {
      ...savedFacts,
      truckGvwrLbs: 20000,
      local: {
        ...emptyLocal,
        tradeName: "Robinson Rentals",
        usdotNumber: "1234576", // June of odd years
        truckRegistrationMonth: 3,
        greeleyLicenseDate: "2025-06-15", // renews 2027, then 2029
      },
    });
    await syncComplianceFilings();
    const greeley = await prisma.complianceFiling.findFirst({
      where: { obligationKey: "greeley.business_license", periodKey: "2027" },
    });
    expect(greeley).toBeTruthy();
    expect(businessDateKey(greeley!.dueOn)).toBe("2027-06-15");
    const registration = await prisma.complianceFiling.findFirst({
      where: { obligationKey: "co.vehicle_registration", periodKey: "2026" },
    });
    expect(registration).toBeTruthy();
    expect(businessDateKey(registration!.dueOn)).toBe("2026-03-31");
    const usdot = await prisma.complianceFiling.findFirst({
      where: { obligationKey: "fed.usdot", periodKey: "2027" },
    });
    expect(usdot).toBeTruthy();
    expect(businessDateKey(usdot!.dueOn)).toBe("2027-06-30");
    const usdotEven = await prisma.complianceFiling.findFirst({
      where: { obligationKey: "fed.usdot", periodKey: "2028" },
    });
    expect(usdotEven).toBeNull(); // odd-parity number: no 2028 update in the sync window
  });

  it("an over-threshold declaration prepares and stays ready for review", async () => {
    const rule = await prisma.legalRuleVersion.create({
      data: {
        ruleKey: "co.bpp.exemption_threshold",
        value: 50000,
        effectiveFrom: day("2026-01-01"),
        origin: "OWNER",
        sourceQuote: "CMP-4 test: lower the bar so the small test fleet is over it.",
        createdByUserId: ownerId,
      },
    });
    ruleIds.push(rule.id);
    await syncComplianceFilings();
    const filing = await prisma.complianceFiling.findFirstOrThrow({
      where: { obligationKey: "co.bpp.weld_declaration", periodKey: "2027" },
    });
    const profile = await getComplianceProfile();
    const data = await buildBppPreparedData(filing, profile);
    const snap = data.snapshot as { thresholdCents: number; verdict: string };
    expect(snap.thresholdCents).toBe(50000);
    expect(snap.verdict).toBe("OVER");
    await prepareFiling(ownerId, filing.id, data);
    const prepared = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(prepared.state).toBe("READY_FOR_REVIEW");
  });

  it("an under-threshold declaration prepares, then closes as not needed with its numbers kept", async () => {
    const rule = await prisma.legalRuleVersion.create({
      data: {
        ruleKey: "co.bpp.exemption_threshold",
        value: 99999999900,
        effectiveFrom: day("2026-06-01"),
        origin: "OWNER",
        sourceQuote: "CMP-4 test: raise the bar so the verdict is under on any shared test fleet.",
        createdByUserId: ownerId,
      },
    });
    ruleIds.push(rule.id);
    const filing = await prisma.complianceFiling.findFirstOrThrow({
      where: { obligationKey: "co.bpp.weld_declaration", periodKey: "2027" },
    });
    const profile = await getComplianceProfile();
    const data = await buildBppPreparedData(filing, profile);
    const snap = data.snapshot as { thresholdCents: number; verdict: string };
    expect(snap.thresholdCents).toBe(99999999900);
    expect(snap.verdict).toBe("UNDER");
    await prepareFiling(ownerId, filing.id, data);
    const prepared = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(prepared.state).toBe("READY_FOR_REVIEW");
    await markFilingNotApplicable(ownerId, filing.id, "No declaration needed — under the exemption.");
    const closed = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filing.id } });
    expect(closed.state).toBe("NOT_APPLICABLE");
    const kept = closed.preparedData as { snapshot?: { totalCostCents?: number } } | null;
    expect(kept?.snapshot?.totalCostCents).toBeGreaterThanOrEqual(101000);
  });
});
