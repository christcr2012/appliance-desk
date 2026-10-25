import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { runTelecomAlertPreview } from "@/domains/messaging/telecom-alert-check";
import { telecomReportPeriods } from "@/domains/messaging/telecom-periods";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("nightly spend-alert check (isolated PostgreSQL)", () => {
  const name = "alc-" + randomUUID().slice(0, 8);
  const owner = name + "-o", accountId = name + "-a";
  const now = new Date("2026-10-20T12:00:00Z");
  const { current } = telecomReportPeriods(now);
  let old: { communicationsPolicy: unknown; communicationsPolicyVersion: number };
  const setRules = async (enabledRules: boolean) => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { communicationsPolicyVersion: old.communicationsPolicyVersion + 1,
      communicationsPolicy: { schemaVersion: 1, manualSmsEnabled: false, primaryAccountId: accountId, primaryNumberId: "x",
        approvedPolicyVersion: old.communicationsPolicyVersion + 1, maxSegments: 3, supportedCountries: ["US"],
        telecomCostAlerts: { enabled: enabledRules, monthlyBudgetCents: 5000, elevatedCents: 7500, criticalCents: 10000,
          spikePercentBasisPoints: 5000, minimumSpikeCents: 1000, staleAfterHours: 48 } } } });
  };

  beforeAll(async () => {
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { communicationsPolicy: true, communicationsPolicyVersion: true } });
    await prisma.user.create({ data: { id: owner, email: owner + "@example.test", role: "OWNER" } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "TEST", provider: "twilio", externalAccountId: name, label: "alc", status: "READY" } });
    await prisma.telecomUsageSnapshot.create({ data: { accountId, category: "totalprice", startDate: current.start, endDate: current.end,
      count: 1, countUnit: "x", usage: 1, usageUnit: "x", price: 120, currency: "USD", providerAsOf: now, isTotal: true,
      payloadHash: "a".repeat(64), providerSource: "test" } });
    await prisma.telecomSyncCursor.create({ data: { accountId, resource: "USAGE", windowStart: current.start, windowEnd: current.end,
      completedThrough: current.end, lastSuccessAt: new Date(now.getTime() - 3600_000) } });
  });
  afterAll(async () => {
    await prisma.telecomSyncCursor.deleteMany({ where: { accountId } });
    await prisma.telecomUsageSnapshot.deleteMany({ where: { accountId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.auditLog.deleteMany({ where: { userId: owner } });
    await prisma.user.deleteMany({ where: { id: owner } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { communicationsPolicy: old.communicationsPolicy as object,
      communicationsPolicyVersion: old.communicationsPolicyVersion } });
  });

  it("does nothing until the owner turns the alert rules on", async () => {
    await setRules(false);
    expect(await runTelecomAlertPreview([accountId], now)).toEqual({ checked: 0, warnings: 0 });
  });
  it("counts warnings from fresh, complete provider spend and notifies no one", async () => {
    await setRules(true);
    const before = await prisma.messageDelivery.count();
    const r = await runTelecomAlertPreview([accountId], now);
    expect(r.checked).toBe(1);
    expect(r.warnings).toBeGreaterThanOrEqual(1); // $120 is past the $100 critical line
    expect(await prisma.messageDelivery.count()).toBe(before);
  });
});
