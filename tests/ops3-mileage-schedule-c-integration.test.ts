import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { addManualTrip, saveVehicle, saveVehicleSettings } from "@/domains/vehicle/actions";
import { loadVehicleOverview } from "@/domains/vehicle/reads";
import { vehicleYearFigures } from "@/domains/vehicle/yearly";
import { computeScheduleCYear } from "@/domains/compliance/schedule-c";

// OPS-3 -> CMP-2: line 9 (car and truck) uses ONE method, never both, and shows the other as a comparison.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const YEAR = 2026; // the rule book has the 72.5 cents rate for 2026
const NO_RATE_YEAR = 2005; // before the first rate in the rule book

describe.skipIf(!enabled)("mileage feeds Schedule C line 9 (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  let ownerId = "";
  let vehicleId = "";
  let entryId = "";
  let before: { mileageMethod: "STANDARD_RATE" | "ACTUAL_COSTS"; vehicleMedicalCardRequired: boolean } | null = null;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    before = await prisma.businessSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {}, select: { mileageMethod: true, vehicleMedicalCardRequired: true } });
  });

  afterAll(async () => {
    await prisma.mileageTrip.deleteMany({ where: { vehicleId } });
    await prisma.fleetVehicle.deleteMany({ where: { id: vehicleId } });
    if (entryId) {
      await prisma.journalLine.deleteMany({ where: { entryId } });
      await prisma.journalEntry.deleteMany({ where: { id: entryId } });
    }
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: vehicleId }, { action: "settings.vehicle", userId: ownerId }] } });
    if (before) await prisma.businessSettings.update({ where: { id: "singleton" }, data: before });
  });

  it("uses the standard rate or the books, never both, and shows the other way for comparison", async () => {
    await saveVehicleSettings(ownerId, { mileageMethod: "ACTUAL_COSTS", medicalCardRequired: before!.vehicleMedicalCardRequired });
    const base = await computeScheduleCYear(YEAR);
    const baseMiles = (await vehicleYearFigures(YEAR)).miles;
    vehicleId = await saveVehicle(ownerId, null, { nickname: `Van ${tag}`, year: 2021, make: "Ford", model: "Transit", gvwrLbs: 9500, odometerAtPurchase: 0, registrationMonth: null });
    await addManualTrip(ownerId, { vehicleId, dateKey: "2026-06-02", startOdometer: 1_000, endOdometer: 1_200, purpose: "Supply run" });
    const fuel = await prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole: "EXPENSE_FUEL" } });
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { systemRole: "BANK" } });
    entryId = (await prisma.journalEntry.create({
      data: {
        entryDate: businessDateFromKey("2026-06-03")!, periodKey: "2026-06", sourceType: "EXPENSE", sourceId: `ops3sc-${tag}`, eventKind: "OPS3_TEST", memo: "OPS-3 fuel test",
        lines: { create: [{ ledgerAccountId: fuel.id, debitCents: 50_000, creditCents: 0 }, { ledgerAccountId: bank.id, debitCents: 0, creditCents: 50_000 }] },
      },
    })).id;

    // Actual costs chosen: line 9 is what the books posted; the standard figure is only a comparison.
    const actual = await computeScheduleCYear(YEAR);
    const line9 = (r: typeof actual) => r.lines.find((l) => l.line === "9")!;
    expect(actual.vehicle.method).toBe("ACTUAL_COSTS");
    expect(line9(actual).cents).toBe(line9(base).cents + 50_000);
    expect(actual.vehicle.miles).toBe(baseMiles + 200);
    expect(actual.vehicle.rateTenths).toBe(725);
    expect(actual.vehicle.standardCents).toBe(Math.round(((baseMiles + 200) * 725) / 10));
    expect(actual.vehicle.note).toMatch(/Actual costs chosen/);

    // Standard rate chosen: line 9 is miles times the rate; the books' vehicle costs are NOT added on top.
    await saveVehicleSettings(ownerId, { mileageMethod: "STANDARD_RATE", medicalCardRequired: before!.vehicleMedicalCardRequired });
    const standard = await computeScheduleCYear(YEAR);
    expect(standard.vehicle.method).toBe("STANDARD_RATE");
    expect(line9(standard).cents).toBe(standard.vehicle.standardCents);
    expect(line9(standard).accounts).toHaveLength(1);
    expect(standard.vehicle.actualCents).toBe(actual.vehicle.actualCents);
    expect(standard.totalExpensesCents - actual.totalExpensesCents).toBe(standard.vehicle.standardCents! - actual.vehicle.actualCents);
    expect(standard.netProfitCents).toBe(standard.totalIncomeCents - standard.totalExpensesCents);
    expect(line9(standard).accounts[0].name).toContain("Standard mileage rate");
    expect(standard.vehicle.note).toContain("shown for comparison only");

    // The vehicle page shows the same two figures side by side.
    const overview = await loadVehicleOverview(new Date(`${YEAR}-12-01T12:00:00Z`));
    const row = overview.years.find((y) => y.year === YEAR)!;
    expect(row.deductionCents).toBe(standard.vehicle.standardCents);
    expect(row.actualCents).toBe(actual.vehicle.actualCents);
  });

  it("with the standard rate and no rate on file for the year, line 9 is zero and says why (never a guess)", async () => {
    await saveVehicleSettings(ownerId, { mileageMethod: "STANDARD_RATE", medicalCardRequired: before!.vehicleMedicalCardRequired });
    const result = await computeScheduleCYear(NO_RATE_YEAR);
    expect(result.vehicle.standardCents).toBeNull();
    expect(result.lines.find((l) => l.line === "9")!.cents).toBe(0);
    expect(result.vehicle.note).toMatch(/no rate for 2005/);
  });
});
