import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { syncTelecomUsage } from "@/domains/messaging/telecom-sync";
import type { TelecomReadAdapter, TelecomReadPage } from "@/lib/communications/providers/twilio-read";

const parsed = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";
const id = randomUUID().replaceAll("-", "").slice(0, 12);
const accountId = "com-l11-account-" + id;
const numberId = "com-l11-number-" + id;
const deliveryId = "com-l11-delivery-" + id;
const attemptId = "com-l11-attempt-" + id;
const providerSid = "SM" + "a".repeat(32);
const windowStart = new Date("2026-10-01T00:00:00Z");
const windowEnd = new Date("2026-11-01T00:00:00Z");
const checkedAt = new Date("2026-10-09T14:00:00Z");
function adapter(fn: TelecomReadAdapter["read"]): TelecomReadAdapter {
  return { read: fn };
}
function usage(category: string, price: string | null, hash: string): Extract<TelecomReadPage, {kind:"USAGE"}>["items"][number] {
  return {
    category, price, hash, startDate: "2026-10-01", endDate: "2026-10-02",
    count: "2.0000000000", countUnit: "messages", usage: "0.0100000000",
    usageUnit: "units", currency: "USD", isTotal: category === "totalprice",
  };
}
function resource(price: string | null): Extract<TelecomReadPage, {kind:"MESSAGES" | "CALLS"}>["items"][number] {
  return { sid: providerSid, accountSid: "AC" + "b".repeat(32),
    price, currency: "USD", occurredAt: "2026-10-01T10:00:00Z",
    quantity: "2.0000000000", unit: "segments" };
}

describe.skipIf(!enabled)("COM-L11 real PostgreSQL provider-page sync", () => {
  beforeAll(async () => {
    await prisma.telecomAccount.create({ data: {
      id: accountId, provider: "twilio", environment: "TEST",
      externalAccountId: "AC" + "b".repeat(32), label: "Isolated COM-L11 fixture",
    } });
    await prisma.businessPhoneNumber.create({ data: {
      id: numberId, accountId, address: "+13035551234",
      providerNumberId: "PN" + "c".repeat(32),
      isPrimary: true,
    } });
    await prisma.messageDelivery.create({ data: {
      id: deliveryId, idempotencyKey: deliveryId, channel: "SMS",
      purpose: "TRANSACTIONAL", recipientType: "TEST", recipientAddress: "+13035551234",
      templateKey: "com-l11-test", telecomAccountId: accountId,
    } });
    await prisma.messageAttempt.create({ data: {
      id: attemptId, deliveryId, accountId, attemptNumber: 1,
      operationKey: attemptId, providerResourceId: providerSid,
      requestHash: "isolated-synthetic-request",
    } });
  });
  afterAll(async () => {
    await prisma.communicationCostFact.deleteMany({ where: { accountId } });
    await prisma.telecomUsageSnapshot.deleteMany({ where: { accountId } });
    await prisma.telecomRateVersion.deleteMany({ where: { accountId } });
    await prisma.telecomSyncCursor.deleteMany({ where: { accountId } });
    await prisma.messageAttempt.deleteMany({ where: { id: attemptId } });
    await prisma.messageDelivery.deleteMany({ where: { id: deliveryId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
  });

  it("persists only successful GMT usage pages, resumes after failure and dedupes replay", async () => {
    const next = "/2010-04-01/Accounts/AC" + "b".repeat(32) + "/Usage/Records.json?Page=1";
    let shouldFail = true;
    const received: Array<string | null> = [];
    const read = adapter(async input => {
      received.push(input.next);
      if (input.next === null) return {
        kind: "USAGE", items: [usage("totalprice", "0.0025000000", "a".repeat(64))],
        next,
      };
      if (shouldFail) throw new Error("TELECOM_PROVIDER_UNAVAILABLE");
      return { kind: "USAGE", items: [usage("sms-outbound", null, "b".repeat(64))], next: null };
    });
    await expect(syncTelecomUsage({ accountId, resource: "USAGE",
      windowStart, windowEnd, now: checkedAt, adapter: read,
    })).rejects.toThrow("TELECOM_PROVIDER_UNAVAILABLE");
    const failed = await prisma.telecomSyncCursor.findUniqueOrThrow({
      where: { accountId_resource: { accountId, resource: "USAGE" } },
    });
    expect(failed.nextPageToken).toBe(next);
    expect(failed.completedThrough).toBeNull();
    expect(failed.lastErrorCode).toBe("TELECOM_PROVIDER_UNAVAILABLE");
    expect(await prisma.telecomUsageSnapshot.count({ where: { accountId } })).toBe(1);
    shouldFail = false;
    const recovered = await syncTelecomUsage({ accountId, resource: "USAGE",
      windowStart, windowEnd, now: new Date(+checkedAt + 1000), adapter: read });
    expect(recovered).toMatchObject({ completed: true, pages: 1, records: 1, unknownPrices: 1 });
    expect(received).toEqual([null, next, next]);
    expect(await prisma.telecomUsageSnapshot.count({ where: { accountId } })).toBe(2);
    const observed = await prisma.telecomUsageSnapshot.findMany({
      where: { accountId }, orderBy: { category: "asc" },
    });
    expect(observed.map(x => x.startDate.toISOString().slice(0,10))).toEqual([
      "2026-10-01", "2026-10-01",
    ]);
    expect(observed.find(x => x.category === "sms-outbound")?.price).toBeNull();
    await syncTelecomUsage({ accountId, resource: "USAGE",
      windowStart, windowEnd, now: new Date(+checkedAt + 2000), adapter: read });
    expect(await prisma.telecomUsageSnapshot.count({ where: { accountId } })).toBe(2);
  });


  it("preserves delayed signed prices as revisions linked to the same account attempt", async () => {
    let observation = "-0.0075000000";
    const provider = adapter(async () => ({
      kind: "MESSAGES", items: [resource(observation)], next: null,
    }));
    const first = await syncTelecomUsage({ accountId, resource: "MESSAGES",
      windowStart, windowEnd, now: checkedAt, adapter: provider });
    expect(first).toMatchObject({ completed: true, records: 1 });
    const original = await prisma.communicationCostFact.findFirstOrThrow({
      where: { accountId, component: "message" },
    });
    expect(original.amount.toFixed(10)).toBe("0.0075000000");
    expect(original.messageAttemptId).toBe(attemptId);
    observation = "-0.0081000000";
    await syncTelecomUsage({ accountId, resource: "MESSAGES",
      windowStart, windowEnd, now: new Date(+checkedAt + 5000), adapter: provider });
    const revised = await prisma.communicationCostFact.findFirstOrThrow({
      where: { accountId, supersedesId: original.id },
    });
    expect(revised.amount.toFixed(10)).toBe("0.0081000000");
    expect(revised.currency).toBe("USD");
    await syncTelecomUsage({ accountId, resource: "MESSAGES",
      windowStart, windowEnd, now: new Date(+checkedAt + 8000), adapter: provider });
    expect(await prisma.communicationCostFact.count({
      where: { accountId, component: "message" },
    })).toBe(2);
    observation = "-0.0075000000";
    await syncTelecomUsage({ accountId, resource: "MESSAGES",
      windowStart, windowEnd, now: new Date(+checkedAt + 8500), adapter: provider });
    const reverted = await prisma.communicationCostFact.findFirstOrThrow({
      where: { accountId, supersedesId: revised.id },
    });
    expect(reverted.amount.toFixed(10)).toBe("0.0075000000");
    observation = "";
    const unknown = await syncTelecomUsage({ accountId, resource: "MESSAGES",
      windowStart, windowEnd, now: new Date(+checkedAt + 9000),
      adapter: adapter(async () => ({ kind: "MESSAGES", items: [resource(null)], next: null })),
    });
    expect(unknown.unknownPrices).toBe(1);
    expect(await prisma.communicationCostFact.count({
      where: { accountId, component: "message" },
    })).toBe(3);
  });

  it("holds a cursor while one fetch is in flight, rejecting duplicate workers", async () => {
    const control: { allow?: () => void } = {};
    let begun: (() => void) | null = null;
    const started = new Promise<void>(resolve => { begun = resolve; });
    const release = new Promise<void>(resolve => { control.allow = resolve; });
    const provider = adapter(async () => {
      begun?.(); await release;
      return { kind: "CALLS", items: [], next: null };
    });
    const first = syncTelecomUsage({ accountId, resource: "CALLS",
      windowStart, windowEnd, now: checkedAt, adapter: provider });
    await started;
    await expect(syncTelecomUsage({ accountId, resource: "CALLS",
      windowStart, windowEnd, now: checkedAt, adapter: provider })).rejects.toThrow("SYNC_BUSY");
    control.allow?.();
    expect((await first).completed).toBe(true);
  });

  it("does not confuse pricing revisions or readiness with sending approval", async () => {
    const mkRate = (rate: string): TelecomReadAdapter => adapter(async () => ({
      kind: "PRICING", next: null, items: [{
        service: "SMS", category: "outbound", destinationCountry: "US",
        destinationPrefix: "310:410", destinationKey: "US:310:410:outbound:local",
        senderType: "local", component: "base", rate, currency: "USD", unit: "segment",
      }],
    }));
    await syncTelecomUsage({ accountId, resource: "PRICING",
      windowStart, windowEnd, now: checkedAt, adapter: mkRate("0.0083000000") });
    await syncTelecomUsage({ accountId, resource: "PRICING",
      windowStart, windowEnd, now: new Date(+checkedAt + 1000),
      adapter: mkRate("0.0083000000") });
    expect(await prisma.telecomRateVersion.count({ where: { accountId } })).toBe(1);
    await syncTelecomUsage({ accountId, resource: "PRICING",
      windowStart, windowEnd, now: new Date(+checkedAt + 2000),
      adapter: mkRate("0.0084000000") });
    const rates = await prisma.telecomRateVersion.findMany({
      where: { accountId }, orderBy: { effectiveFrom: "asc" },
    });
    expect(rates).toHaveLength(2);
    expect(rates[0].effectiveUntil).toEqual(rates[1].effectiveFrom);
    expect(rates[1].rate.toFixed(10)).toBe("0.0084000000");

    await syncTelecomUsage({ accountId, resource: "READINESS",
      windowStart, windowEnd, now: checkedAt,
      adapter: adapter(async () => ({
        kind: "READINESS", next: null, items: [{
          accountStatus: "active", numberId: "PN" + "c".repeat(32),
          numberConfirmed: true, voice: true, sms: true,
        }],
      })),
    });
    const account = await prisma.telecomAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.status).toBe("UNCONFIGURED");
    expect(account.readiness).toMatchObject({
      providerAccountStatus: "active", a2pApprovalVerified: false,
    });
  });
});
