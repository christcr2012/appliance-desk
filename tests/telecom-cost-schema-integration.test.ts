import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BACKUP_TABLES } from "@/domains/backup/manifest";

const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const disposable = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(db.hostname) &&
  db.pathname === "/appliance_desk_test";

describe.skipIf(!disposable)("COM-L10 telecom costs and checkpoint schema (throwaway PostgreSQL)", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const first = "cost10-a-" + suffix, second = "cost10-b-" + suffix;
  const firstPhone = "cost10-phone-a-" + suffix, secondPhone = "cost10-phone-b-" + suffix;
  const actor = "cost10-owner-" + suffix;
  const observed = new Date("2026-10-09T15:00:00Z");
  const windowStart = new Date("2026-10-01T00:00:00Z");
  const windowEnd = new Date("2026-11-01T00:00:00Z");
  const asOf = new Date("2026-10-09T18:00:00Z");

  beforeAll(async () => {
    await prisma.telecomAccount.createMany({ data: [
      { id: first, provider: "twilio", environment: "TEST",
        externalAccountId: "synthetic-cost10-a-" + suffix, label: "COM-L10 A" },
      { id: second, provider: "twilio", environment: "TEST",
        externalAccountId: "synthetic-cost10-b-" + suffix, label: "COM-L10 B" },
    ] });
    await prisma.businessPhoneNumber.createMany({ data: [
      { id: firstPhone, accountId: first, address: "+13035551871",
        providerNumberId: "cost10-a-" + suffix },
      { id: secondPhone, accountId: second, address: "+13035551872",
        providerNumberId: "cost10-b-" + suffix },
    ] });
    await prisma.user.create({ data: {
      id: actor, email: "cost10-" + suffix + "@example.test", role: "OWNER",
    } });
  });

  afterAll(async () => {
    await prisma.communicationCostFact.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.telecomUsageSnapshot.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.telecomRateVersion.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.telecomStatement.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.telecomSyncCursor.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.businessPhoneNumber.deleteMany({ where: { accountId: { in: [first,second] } } });
    await prisma.telecomAccount.deleteMany({ where: { id: { in: [first,second] } } });
    await prisma.user.deleteMany({ where: { id: actor } });
  });

  it("backs up all five account-scoped evidence tables explicitly", () => {
    for (const table of ["telecomSyncCursor", "telecomUsageSnapshot",
      "communicationCostFact", "telecomRateVersion", "telecomStatement"]) {
      expect(BACKUP_TABLES).toContain(table);
    }
  });

  it("keeps page cursors unique, bounded, paired and rollback-safe", async () => {
    const cursor = await prisma.telecomSyncCursor.create({ data: {
      accountId: first, resource: "USAGE", windowStart, windowEnd,
      completedThrough: observed, lastSuccessAt: observed,
    } });
    await expect(prisma.telecomSyncCursor.create({ data: {
      accountId: first, resource: "USAGE", windowStart, windowEnd,
    } })).rejects.toThrow();
    await expect(prisma.telecomSyncCursor.create({ data: {
      accountId: second, resource: "USAGE", windowStart: windowEnd, windowEnd: windowStart,
    } })).rejects.toThrow();
    await expect(prisma.telecomSyncCursor.update({ where: { id: cursor.id },
      data: { claimToken: "owner-claim" },
    })).rejects.toThrow();
    await expect(prisma.telecomSyncCursor.update({ where: { id: cursor.id },
      data: { completedThrough: new Date("2026-12-01T00:00:00Z") },
    })).rejects.toThrow();
    await expect(prisma.$transaction(async tx => {
      await tx.telecomSyncCursor.update({ where: { id: cursor.id },
        data: { nextPageToken: "new-checkpoint" },
      });
      throw new Error("simulated incomplete provider page");
    })).rejects.toThrow("simulated");
    const unchanged = await prisma.telecomSyncCursor.findUniqueOrThrow({ where: { id: cursor.id } });
    expect(unchanged.nextPageToken).toBeNull();
    expect(unchanged.completedThrough?.getTime()).toBe(observed.getTime());
  });

  it("retains signed/null provider prices, append versions and exact Decimal(24,10)", async () => {
    const a = { accountId: first, category: "sms-outbound",
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-10-01T00:00:00Z"),
      count: "4.0000000000", countUnit: "messages",
      usage: "0.0000000001", usageUnit: "units",
      price: "-0.0000000001", currency: "USD",
      providerAsOf: asOf, payloadHash: "a".repeat(64),
      providerSource: "twilio-usage",
    };
    const one = await prisma.telecomUsageSnapshot.create({ data: a });
    expect(one.price?.toFixed(10)).toBe("-0.0000000001");
    expect(one.usage.toFixed(10)).toBe("0.0000000001");
    await expect(prisma.telecomUsageSnapshot.create({ data: a })).rejects.toThrow();
    const correction = await prisma.telecomUsageSnapshot.create({ data: {
      ...a, price: null, payloadHash: "b".repeat(64),
    } });
    expect(correction.price).toBeNull();
    expect(await prisma.telecomUsageSnapshot.count({
      where: { accountId: first, category: "sms-outbound" },
    })).toBe(2);
    await expect(prisma.telecomUsageSnapshot.create({ data: {
      ...a, payloadHash: "c".repeat(64), count: "-1",
    } })).rejects.toThrow();
    await expect(prisma.telecomUsageSnapshot.create({ data: {
      ...a, payloadHash: "d".repeat(64), currency: "usd",
    } })).rejects.toThrow();
  });

  it("stores private statement evidence, verifies with actor, preserves signed costs", async () => {
    const statement = await prisma.telecomStatement.create({ data: {
      accountId: first, externalId: "synthetic-statement-" + suffix,
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-10-31T00:00:00Z"),
      currency: "USD", invoiceTotalCents: 1075,
      issueDate: new Date("2026-11-05T00:00:00Z"),
      privateEvidenceStorageKey: "telecom-statements/" + suffix + "/statement.pdf",
      evidenceHash: "b".repeat(64),
    } });
    await expect(prisma.telecomStatement.update({ where: { id: statement.id },
      data: { state: "VERIFIED" },
    })).rejects.toThrow();
    const verified = await prisma.telecomStatement.update({ where: { id: statement.id },
      data: { state: "VERIFIED", verifiedByUserId: actor, verifiedAt: new Date() },
    });
    expect(verified.verifiedByUserId).toBe(actor);
    await expect(prisma.telecomStatement.create({ data: {
      accountId: first, externalId: "invalid-location-" + suffix,
      periodStart: windowStart, periodEnd: windowEnd, currency: "USD",
      invoiceTotalCents: 0, issueDate: observed,
      privateEvidenceStorageKey: "https://example.test/public.pdf",
      evidenceHash: "c".repeat(64),
    } })).rejects.toThrow();

    const rate = await prisma.telecomRateVersion.create({ data: {
      accountId: first, service: "SMS", category: "outbound", senderType: "local",
      component: "base", destinationKey: "US:ALL", rate: "0.0000000001",
      currency: "USD", unit: "message", source: "PRICING_API",
      effectiveFrom: windowStart, fetchedAt: asOf,
    } });
    expect(rate.rate.toFixed(10)).toBe("0.0000000001");
    await expect(prisma.telecomRateVersion.create({ data: {
      accountId: second, service: "SMS", category: "outbound", senderType: "local",
      component: "base", destinationKey: "US:ALL", rate: "0.1", currency: "USD",
      unit: "message", source: "PRICING_API", effectiveFrom: windowEnd,
      effectiveUntil: windowStart, fetchedAt: asOf,
    } })).rejects.toThrow();

    const firstFact = await prisma.communicationCostFact.create({ data: {
      accountId: first, businessNumberId: firstPhone, rateVersionId: rate.id,
      sourceKey: "synthetic-usage-" + suffix, component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "-0.0000000001",
      currency: "USD", quantity: "1", unit: "message", occurredAt: observed,
    } });
    expect(firstFact.amount.toFixed(10)).toBe("-0.0000000001");
    await expect(prisma.communicationCostFact.create({ data: {
      accountId: first, sourceKey: firstFact.sourceKey, component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "0.0", currency: "USD",
      occurredAt: observed,
    } })).rejects.toThrow();
    const revision = await prisma.communicationCostFact.create({ data: {
      accountId: first, supersedesId: firstFact.id,
      sourceKey: "synthetic-usage-rev2-" + suffix, component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "0.0000000001",
      currency: "USD", occurredAt: observed,
    } });
    expect(revision.supersedesId).toBe(firstFact.id);
    const matchedStatement = await prisma.communicationCostFact.create({ data: {
      accountId: first, statementId: statement.id,
      sourceKey: "synthetic-statement-line-" + suffix, component: "tax",
      classification: "INVOICE_RECONCILED", amount: "0.75",
      currency: "USD", occurredAt: observed,
    } });
    expect(matchedStatement.amount.toFixed(2)).toBe("0.75");
    await expect(prisma.communicationCostFact.create({ data: {
      accountId: first, sourceKey: "no-statement-" + suffix,
      component: "tax", classification: "INVOICE_RECONCILED",
      amount: "1.00", currency: "USD", occurredAt: observed,
    } })).rejects.toThrow();
  });

  it("rejects cross-account cost attribution and cross-basis revisions at the DB boundary", async () => {
    const good = await prisma.communicationCostFact.create({ data: {
      accountId: first, sourceKey: "good-crosscheck-" + suffix,
      component: "SMS", classification: "ESTIMATED",
      amount: "0.01", currency: "USD", occurredAt: observed,
    } });
    await expect(prisma.communicationCostFact.create({ data: {
      accountId: first, businessNumberId: secondPhone,
      sourceKey: "wrong-account-" + suffix, component: "SMS",
      classification: "ESTIMATED", amount: "0.01", currency: "USD",
      occurredAt: observed,
    } })).rejects.toThrow("account");
    await expect(prisma.communicationCostFact.create({ data: {
      accountId: second, supersedesId: good.id,
      sourceKey: "bad-supersedes-" + suffix, component: "SMS",
      classification: "ESTIMATED", amount: "-0.01", currency: "USD",
      occurredAt: observed,
    } })).rejects.toThrow("account");
    await expect(prisma.communicationCostFact.create({ data: {
      accountId: first, supersedesId: good.id,
      sourceKey: "bad-layer-" + suffix, component: "SMS",
      classification: "PROVIDER_REPORTED", amount: "0.01", currency: "USD",
      occurredAt: observed,
    } })).rejects.toThrow("basis");
  });
});
