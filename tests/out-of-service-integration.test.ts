import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobApplianceResult } from "@prisma/client";

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({}) }));
vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }) }));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { stageSwap } from "@/domains/inventory/guided-actions";
import { resolveOutOfService } from "@/domains/billing/out-of-service";
import { getExceptionOverview } from "@/domains/exceptions";
import { businessDateFromKey } from "@/lib/business-date";

// W-21A (D-WB8 case 3), real Postgres: a machine taken for repair with no replacement is credited the days without it.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("machines out for repair with no replacement (W-21A)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ownerId = `oos-owner-${tag}`;
  const userId = `oos-user-${tag}`;
  const customerId = `oos-customer-${tag}`;
  const addressId = `oos-address-${tag}`;
  const washerType = `oos-washer-${tag}`;
  const dryerType = `oos-dryer-${tag}`;
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const day = (key: string) => businessDateFromKey(key)!;
  const key = () => `oos-key-${randomUUID()}`;

  async function agreement(lines: Array<{ price: number }>, extra: { paidInFullInAdvance?: boolean } = {}) {
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        billingStartedAt: day("2026-09-01"),
        ...extra,
        lines: { create: lines.map((l, i) => ({ label: `Line ${i}`, monthlyPriceCents: l.price, listPriceCents: l.price })) },
      },
      include: { lines: { orderBy: { label: "asc" } } },
    });
    return { id: created.id, lineIds: created.lines.map((l) => l.id) };
  }
  async function unit(type: string, status: "AVAILABLE" | "RENTED") {
    const id = `oos-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `OOS${applianceIds.length}-${tag.slice(0, 6)}`, applianceTypeId: type, status } });
    return id;
  }
  async function rented(lineId: string, agreementId: string, type: string) {
    const id = await unit(type, "RENTED");
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: id } });
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: id, customerId, agreementId, startEvidence: "MANUAL", startedOn: day("2026-09-01") } });
    return id;
  }
  async function swap(original: string, type: string) {
    const replacement = await unit(type, "AVAILABLE");
    const { jobId } = await stageSwap(ownerId, { originalApplianceId: original, replacementApplianceId: replacement, scheduledAt: null });
    jobIds.push(jobId);
    await prisma.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS" } });
    return { jobId, replacement };
  }
  const finish = (jobId: string, on: string, results: Array<[string, JobApplianceResult]>) =>
    completeJob(ownerId, {
      jobId,
      expectedVersion: 1,
      completionKey: key(),
      performedOn: day(on),
      completionNotes: null,
      results: results.map(([applianceId, result]) => ({ applianceId, result })),
    });
  const creditFor = (applianceId: string) =>
    prisma.outOfServicePeriod.findFirst({ where: { applianceId }, orderBy: { createdAt: "desc" } }).then((p) =>
      p?.creditId ? prisma.customerCredit.findUnique({ where: { id: p.creditId } }) : null,
    );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "OOS Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "Pat Repair", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `O${tag}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Repair St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.createMany({
      data: [
        { id: washerType, name: `Washer ${tag}`, slug: `oos-washer-${tag}` },
        { id: dryerType, name: `Dryer ${tag}`, slug: `oos-dryer-${tag}` },
      ],
    });
  });

  afterAll(async () => {
    const credits = await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } });
    await prisma.outOfServicePeriod.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: credits.map((c) => c.id) } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: [...applianceIds, ...jobIds] } }] } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreement: { customerId } } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [washerType, dryerType] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("a set's dryer taken for repair, replaced 6 days later: credit is exactly the dryer's half of the set price for 6 days", async () => {
    const a = await agreement([{ price: 6000 }]);
    const washer = await rented(a.lineIds[0]!, a.id, washerType);
    const dryer = await rented(a.lineIds[0]!, a.id, dryerType);
    const taken = await swap(dryer, dryerType);
    await finish(taken.jobId, "2026-09-10", [[dryer, "RETURNED"], [taken.replacement, "NOT_DELIVERED"]]);

    const period = await prisma.outOfServicePeriod.findFirstOrThrow({ where: { applianceId: dryer, endedOn: null } });
    expect(period.startedOn.toISOString()).toBe(day("2026-09-10").toISOString());
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: dryer } })).toMatchObject({ status: "AWAITING_INSPECTION" });
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: taken.replacement } })).toMatchObject({ status: "AVAILABLE" });
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: washer, closedAt: null } })).toBe(1);

    const todo = await getExceptionOverview();
    const item = todo.items.find((i) => i.category === "OUT_OF_SERVICE" && i.href === `/desk/inventory/${dryer}/out-of-service`);
    expect(item?.title).toMatch(/^Return or replace Pat Repair's dryer/);
    expect(item?.severity).toBe("high"); // out far longer than the 3-day starting value

    // The replacement swap can be staged even though the dryer is no longer at the customer.
    const fix = await swap(dryer, dryerType);
    const done = await finish(fix.jobId, "2026-09-16", [[dryer, "NOT_RETURNED"], [fix.replacement, "DELIVERED"]]);
    const closed = await prisma.outOfServicePeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(closed).toMatchObject({ endReason: "REPLACED", endJobId: fix.jobId, replacementApplianceId: fix.replacement });
    const credit = await creditFor(dryer);
    // 6000 set ÷ 2 machines = 3000 a month; Sept 10–15 = 6 days; ÷ 30 per day → $6.00.
    expect(credit).toMatchObject({ amountCents: 600, sourceType: "OUT_OF_SERVICE", sourceId: period.id });
    expect(credit?.reason).toBe(`Credit – dryer ${tag} out of service – 6 days`);
    expect(await prisma.jobBillingHandoff.count({ where: { jobId: fix.jobId, kind: "PUSH_CREDIT", subjectId: credit!.id } })).toBe(1);
    expect(done.handoffIds.length).toBeGreaterThan(0);
    expect((await getExceptionOverview()).items.some((i) => i.href === `/desk/inventory/${dryer}/out-of-service`)).toBe(false);
  });

  it("a single machine taken for repair and brought back by the owner: custody reopens and the 5 days are credited", async () => {
    const a = await agreement([{ price: 3500 }]);
    const washer = await rented(a.lineIds[0]!, a.id, washerType);
    const taken = await swap(washer, washerType);
    await finish(taken.jobId, "2026-09-20", [[washer, "RETURNED"], [taken.replacement, "NOT_DELIVERED"]]);

    await expect(resolveOutOfService(ownerId, { applianceId: washer, how: "SAME_MACHINE_BACK", on: day("2026-09-19") })).rejects.toThrow(
      /on or after/,
    );
    await expect(resolveOutOfService(ownerId, { applianceId: washer, how: "SAME_MACHINE_BACK", on: day("2099-01-01") })).rejects.toThrow(
      /future/,
    );
    const result = await resolveOutOfService(ownerId, { applianceId: washer, how: "SAME_MACHINE_BACK", on: day("2026-09-25") });
    // 3500 × 5 ÷ 30 = 583.33 → 583, rounded once.
    expect(await creditFor(washer)).toMatchObject({ amountCents: 583 });
    expect(result.creditId).toBeTruthy();
    expect(await prisma.jobBillingHandoff.count({ where: { jobId: taken.jobId, kind: "PUSH_CREDIT", subjectId: result.creditId! } })).toBe(1);
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: washer } })).toMatchObject({ status: "RENTED" });
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: washer, closedAt: null } })).toBe(1);
    await expect(resolveOutOfService(ownerId, { applianceId: washer, how: "CLOSED_BY_OWNER", on: day("2026-09-26") })).rejects.toThrow(
      /no open repair period/,
    );
  });

  it("paid-in-full rentals get no automatic credit; the owner can close a period without a replacement", async () => {
    const a = await agreement([{ price: 3500 }], { paidInFullInAdvance: true });
    const dryer = await rented(a.lineIds[0]!, a.id, dryerType);
    const taken = await swap(dryer, dryerType);
    await finish(taken.jobId, "2026-09-05", [[dryer, "RETURNED"], [taken.replacement, "NOT_DELIVERED"]]);
    const result = await resolveOutOfService(ownerId, { applianceId: dryer, how: "CLOSED_BY_OWNER", on: day("2026-09-08") });
    expect(result.creditId).toBeNull();
    expect(result.note).toMatch(/paid in full/);
    expect(await prisma.outOfServicePeriod.findFirstOrThrow({ where: { applianceId: dryer } })).toMatchObject({ endReason: "CLOSED_BY_OWNER" });
  });

  it("a pickup of one machine while the other stays opens a period; a pickup of everything does not", async () => {
    const a = await agreement([{ price: 6000 }]);
    const washer = await rented(a.lineIds[0]!, a.id, washerType);
    const dryer = await rented(a.lineIds[0]!, a.id, dryerType);
    const removal = await prisma.job.create({
      data: { type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId: a.id, appliances: { create: [{ applianceId: dryer }] } },
    });
    jobIds.push(removal.id);
    await finish(removal.id, "2026-09-12", [[dryer, "RETURNED"]]);
    expect(await prisma.outOfServicePeriod.count({ where: { applianceId: dryer, endedOn: null } })).toBe(1);

    const b = await agreement([{ price: 3500 }]);
    const only = await rented(b.lineIds[0]!, b.id, washerType);
    const all = await prisma.job.create({
      data: { type: "REMOVAL", status: "IN_PROGRESS", customerId, serviceAddressId: addressId, agreementId: b.id, appliances: { create: [{ applianceId: only }] } },
    });
    jobIds.push(all.id);
    await finish(all.id, "2026-09-12", [[only, "RETURNED"]]);
    expect(await prisma.outOfServicePeriod.count({ where: { applianceId: only } })).toBe(0);
    void washer;
  });
});
