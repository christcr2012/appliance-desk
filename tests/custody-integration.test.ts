import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  closeCustodyEpisodeInTx, CustodyConflictError, findCustodyGaps, findCustodyInvariantViolations,
  getOpenCustody, openCustodyEpisodeInTx, recordManualCustody,
} from "@/domains/inventory/custody";

// Physical custody (Batch C, P2-A) against the real throwaway Postgres: the database rules, the manual entry,
// the two one-way status rules, and the backfill SQL run for just this file's own fixtures.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("custody episodes", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `cu-owner-${tag}`;
  const userId = `cu-user-${tag}`;
  const customerId = `cu-customer-${tag}`;
  const addressId = `cu-address-${tag}`;
  const typeId = `cu-type-${tag}`;
  const agreementId = `cu-agreement-${tag}`;
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  let lineId = "";

  async function unit(status: "AVAILABLE" | "RESERVED" | "RENTED" | "AWAITING_PICKUP" | "MAINTENANCE" | "RETIRED" = "RENTED") {
    const id = `cu-unit-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `CU${applianceIds.length}-${tag.slice(0, 8)}`, applianceTypeId: typeId, status } });
    return id;
  }
  async function job(type: "DELIVERY" | "SWAP" | "REMOVAL", extra: Record<string, unknown> = {}) {
    const id = `cu-job-${jobIds.length}-${tag}`;
    jobIds.push(id);
    return prisma.job.create({ data: { id, type, status: "COMPLETED", customerId, serviceAddressId: addressId, agreementId, ...extra } });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "CU Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "CU Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: `CU ${tag}`, slug: `cu-${tag}` } });
    await prisma.rentalAgreement.create({ data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE", lines: { create: { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 } } } });
    lineId = (await prisma.rentalLine.findFirstOrThrow({ where: { agreementId } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: ownerId }, { entityId: { in: applianceIds } }] } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("custody-one-open-per-appliance-db-rule: a second open stay is refused, never overwritten", async () => {
    const id = await unit();
    const j1 = await job("DELIVERY");
    const j2 = await job("DELIVERY");
    const startedOn = new Date("2026-10-01T06:00:00Z");
    const base = { applianceId: id, customerId, serviceAddressId: addressId, agreementId, startedOn };
    await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { ...base, startJobId: j1.id }));
    // Same job again: nothing new. Another job: refused by the domain function.
    await expect(prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { ...base, startJobId: j1.id }))).resolves.toMatchObject({ alreadyOpenForThisJob: true });
    await expect(prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { ...base, startJobId: j2.id }))).rejects.toBeInstanceOf(CustodyConflictError);
    // And the database itself refuses a raw second open row.
    await expect(
      prisma.applianceCustodyEpisode.create({ data: { applianceId: id, customerId, startedOn, startEvidence: "JOB", startJobId: j2.id } }),
    ).rejects.toThrow();
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: id } })).toBe(1);
  });

  it("closing needs an open stay and is not repeated by the same job", async () => {
    const id = await unit();
    const start = await job("DELIVERY");
    const end = await job("REMOVAL");
    await expect(prisma.$transaction((tx) => closeCustodyEpisodeInTx(tx, { applianceId: id, endedOn: new Date(), endJobId: end.id, endReason: "Returned" }))).rejects.toBeInstanceOf(CustodyConflictError);
    await prisma.$transaction((tx) => openCustodyEpisodeInTx(tx, { applianceId: id, customerId, serviceAddressId: null, agreementId: null, startedOn: new Date("2026-10-01T06:00:00Z"), startJobId: start.id }));
    const closed = await prisma.$transaction((tx) => closeCustodyEpisodeInTx(tx, { applianceId: id, endedOn: new Date("2026-10-02T06:00:00Z"), endJobId: end.id, endReason: "Returned" }));
    expect(closed.alreadyClosedByThisJob).toBe(false);
    await expect(prisma.$transaction((tx) => closeCustodyEpisodeInTx(tx, { applianceId: id, endedOn: new Date(), endJobId: end.id, endReason: "Returned" }))).resolves.toMatchObject({ alreadyClosedByThisJob: true });
    expect(await getOpenCustody(prisma, id)).toBeNull();
    // Closed-ness is all-or-nothing in the database.
    await expect(prisma.applianceCustodyEpisode.update({ where: { id: closed.episodeId }, data: { endEvidence: null } })).rejects.toThrow();
  });

  it("a job-evidence stay must have a date (database rule); a manual stay may have an unknown one", async () => {
    const a = await unit();
    await expect(prisma.applianceCustodyEpisode.create({ data: { applianceId: a, customerId, startEvidence: "JOB", startedOn: null } })).rejects.toThrow();
    await recordManualCustody(ownerId, { applianceId: a, customerId, serviceAddressId: addressId, startedOn: null, reason: "confirmed by phone" });
    expect(await getOpenCustody(prisma, a)).toMatchObject({ startEvidence: "MANUAL", startedOn: null, customerId });
    await expect(recordManualCustody(ownerId, { applianceId: a, customerId, serviceAddressId: null, startedOn: null, reason: "again" })).rejects.toBeInstanceOf(CustodyConflictError);
  });

  it("custody-status-invariants: findCustodyGaps and the invariant check report exactly the broken units", async () => {
    const rentedNoStay = await unit("RENTED");
    const pickupNoStay = await unit("AWAITING_PICKUP");
    const availableWithStay = await unit("AVAILABLE");
    const rentedWithStay = await unit("RENTED");
    const shopRepair = await unit("MAINTENANCE");
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: availableWithStay, customerId, startEvidence: "ESTIMATED" } });
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: rentedWithStay, customerId, startEvidence: "ESTIMATED" } });
    const mine = new Set([rentedNoStay, pickupNoStay, availableWithStay, rentedWithStay, shopRepair]);
    const gaps = (await findCustodyGaps(prisma)).filter((g) => mine.has(g.applianceId)).map((g) => g.applianceId).sort();
    expect(gaps).toEqual([rentedNoStay, pickupNoStay].sort());
    const violations = (await findCustodyInvariantViolations(prisma)).filter((v) => mine.has(v.applianceId));
    expect(violations.map((v) => `${v.applianceId}:${v.open}`).sort()).toEqual([`${rentedNoStay}:false`, `${pickupNoStay}:false`, `${availableWithStay}:true`].sort());
    // A manual record is refused for a unit that is in the shop.
    const shelf = await unit("AVAILABLE");
    await expect(recordManualCustody(ownerId, { applianceId: shelf, customerId, serviceAddressId: null, startedOn: null, reason: "x" })).rejects.toThrow(/in the shop/);
  });

  // ---- backfill ---------------------------------------------------------------------------------------------
  const backfillSql = readFileSync("prisma/migrations/20261003350000_custody_backfill/migration.sql", "utf8").replace(/--.*$/gm, "");
  const statements = (ids: string[]) =>
    backfillSql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => statement.replaceAll(`a."status" IN ('RENTED','AWAITING_PICKUP')`, `a."id" IN (${ids.map((i) => `'${i}'`).join(",")}) AND a."status" IN ('RENTED','AWAITING_PICKUP')`));
  async function runBackfill(ids: string[], timeZone?: string) {
    await prisma.$transaction(async (tx) => {
      if (timeZone) await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${timeZone}'`);
      for (const statement of statements(ids)) await tx.$executeRawUnsafe(statement);
    });
  }

  it("custody-backfill-uses-job-evidence and never copies the reservation time", async () => {
    const id = await unit("RENTED");
    const delivery = await job("DELIVERY", { completedAt: new Date("2026-09-20T18:00:00Z"), performedOn: new Date("2026-09-19T06:00:00Z") });
    await prisma.jobAppliance.create({ data: { jobId: delivery.id, applianceId: id } });
    // A reservation made long before the delivery; its time is not a delivery date.
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: id, assignedAt: new Date("2026-01-01T12:00:00Z") } });
    await runBackfill([id]);
    const episodes = await prisma.applianceCustodyEpisode.findMany({ where: { applianceId: id } });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ startEvidence: "JOB", startJobId: delivery.id, customerId, closedAt: null });
    expect(episodes[0].startedOn?.toISOString()).toBe("2026-09-19T06:00:00.000Z");
  });

  it("custody-backfill-date-is-denver-midnight-as-utc-instant: the same answer under a UTC and a Denver session", async () => {
    const results: string[] = [];
    for (const zone of ["UTC", "America/Denver"]) {
      const id = await unit("RENTED");
      const delivery = await job("DELIVERY", { completedAt: new Date("2026-10-04T03:30:00Z") });
      await prisma.jobAppliance.create({ data: { jobId: delivery.id, applianceId: id } });
      await runBackfill([id], zone);
      results.push((await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: id } })).startedOn!.toISOString());
    }
    // 03:30 UTC on Oct 4 is the evening of Oct 3 in Colorado; Colorado midnight of Oct 3 is 06:00 UTC.
    expect(results).toEqual(["2026-10-03T06:00:00.000Z", "2026-10-03T06:00:00.000Z"]);
  });

  it("custody-backfill-never-copies-reservation-time: with no completed job the date stays unknown and the evidence is an estimate", async () => {
    const id = await unit("RENTED");
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineId, applianceId: id, assignedAt: new Date("2026-02-02T12:00:00Z") } });
    await runBackfill([id]);
    expect(await prisma.applianceCustodyEpisode.findFirstOrThrow({ where: { applianceId: id } })).toMatchObject({ startedOn: null, startEvidence: "ESTIMATED", customerId, agreementId });
  });

  it("custody-backfill-swapped-out-unit-has-no-open-episode: a unit that left in a swap is not given a stay", async () => {
    const id = await unit("MAINTENANCE");
    const swap = await job("SWAP", { completedAt: new Date("2026-09-25T18:00:00Z") });
    await prisma.jobAppliance.create({ data: { jobId: swap.id, applianceId: id } });
    await runBackfill([id]);
    expect(await prisma.applianceCustodyEpisode.count({ where: { applianceId: id } })).toBe(0);
  });

  it("custody-status-invariants: a hand-made status change cannot skip or strand custody", async () => {
    const { updateApplianceStatus } = await import("@/domains/inventory");
    const owner = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const shop = await unit("AVAILABLE");
    await expect(updateApplianceStatus(owner, shop, "RENTED")).rejects.toThrow(/no customer recorded/);
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: shop } }).then((a) => a.status)).toBe("AVAILABLE");
    const out = await unit("RENTED");
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: out, customerId, startEvidence: "MANUAL" } });
    await expect(updateApplianceStatus(owner, out, "RETIRED")).rejects.toThrow(/pickup job/);
    await updateApplianceStatus(owner, out, "AWAITING_PICKUP");
    expect(await prisma.appliance.findUniqueOrThrow({ where: { id: out } }).then((a) => a.status)).toBe("AWAITING_PICKUP");
  });
});
