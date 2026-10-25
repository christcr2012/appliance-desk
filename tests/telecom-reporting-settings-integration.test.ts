import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getServiceReportingSettings, RECOMMENDED_SERVICE_REPORTING } from "@/domains/messaging/telecom-unit-economics";
import { saveServiceReportingSettings } from "@/domains/messaging/telecom-reporting-settings";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N4 owner report settings (isolated PostgreSQL)", () => {
  const name = "rs-" + randomUUID().slice(0, 8);
  const owner = name + "-o", staff = name + "-s";
  let old: { communicationsPolicy: unknown; communicationsPolicyVersion: number };
  let version = 0;

  beforeAll(async () => {
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { communicationsPolicy: true, communicationsPolicyVersion: true } });
    await prisma.user.create({ data: { id: owner, email: owner + "@example.test", role: "OWNER" } });
    await prisma.user.create({ data: { id: staff, email: staff + "@example.test", role: "STAFF" } });
    version = old.communicationsPolicyVersion + 1;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { communicationsPolicyVersion: version,
      communicationsPolicy: { schemaVersion: 1, manualSmsEnabled: false, primaryAccountId: "a", primaryNumberId: "n",
        approvedPolicyVersion: version, maxSegments: 3, supportedCountries: ["US"] } } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { communicationsPolicy: old.communicationsPolicy as object,
      communicationsPolicyVersion: old.communicationsPolicyVersion } });
  });

  it("starts at the recommended values", async () => {
    expect(await getServiceReportingSettings()).toEqual(RECOMMENDED_SERVICE_REPORTING);
  });
  it("owner changes, then restores, the report settings; staff cannot; bad numbers are refused", async () => {
    const saved = await saveServiceReportingSettings(owner, { expectedVersion: version, settings: { forecastScenarios: [300, 100, 300], minForecastCustomerDays: 7, minRateSample: 5 } });
    expect(await getServiceReportingSettings()).toEqual({ forecastScenarios: [100, 300], minForecastCustomerDays: 7, minRateSample: 5 });
    await expect(saveServiceReportingSettings(staff, { expectedVersion: saved.version, settings: null })).rejects.toThrow();
    await expect(saveServiceReportingSettings(owner, { expectedVersion: saved.version, settings: { forecastScenarios: [], minForecastCustomerDays: 7, minRateSample: 5 } })).rejects.toThrow();
    await expect(saveServiceReportingSettings(owner, { expectedVersion: saved.version, settings: { forecastScenarios: [10], minForecastCustomerDays: 0, minRateSample: 5 } })).rejects.toThrow();
    await expect(saveServiceReportingSettings(owner, { expectedVersion: saved.version - 1, settings: null })).rejects.toThrow(/changed/);
    await saveServiceReportingSettings(owner, { expectedVersion: saved.version, settings: null });
    expect(await getServiceReportingSettings()).toEqual(RECOMMENDED_SERVICE_REPORTING);
  });
});
