import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })) }));
import { prisma } from "@/lib/prisma";
import { getUnsignedFollowUpDays, saveUnsignedFollowUpDays } from "@/domains/agreements/unsigned-follow-up";
import { listUnsignedAgreements } from "@/domains/exceptions/unsigned-agreements";
import { createPickupVisitForAgreement } from "@/domains/agreements/pickup-draft";
import { agreementIdsNeedingPickup } from "@/domains/agreements/pickup-needed";
import { listPickupUnscheduled } from "@/domains/exceptions/turning-points-attention";
import { createPickupRequestForUser, getPortalPickupRequests } from "@/domains/portal";
import { closeAgreementInTx } from "@/domains/agreements";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("W-19 flow gaps on real PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "w19-owner-" + tag, staffId = "w19-staff-" + tag, custUserId = "w19-cu-" + tag, customerId = "w19-c-" + tag, addressId = "w19-a-" + tag;
  const typeId = "w19-type-" + tag;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  let oldDays = 3;
  const now = new Date();

  async function agreement(extra: Record<string, unknown> = {}) {
    const a = await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12, startDate: new Date(now.getTime() - 300 * DAY),
      endDate: new Date(now.getTime() + 100 * DAY), depositCents: 0, damageWaiverCents: 0, lateFeeGraceDays: 7, lateFeeCents: 0,
      lateFeePercent: 0, taxRateMilliPercent: 0, ...extra } });
    agreementIds.push(a.id);
    return a;
  }
  async function heldAppliance(agreementId: string) {
    const id = `w19-ap-${applianceIds.length}-${tag}`;
    applianceIds.push(id);
    await prisma.appliance.create({ data: { id, assetNumber: `W19${applianceIds.length}-${tag.slice(0, 6)}`, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: id, customerId, agreementId, startEvidence: "MANUAL", startedOn: new Date(now.getTime() - 100 * DAY) } });
    return id;
  }
  const mine = <T extends { href: string }>(rows: T[], id: string) => rows.filter((r) => r.href.includes(id));

  beforeAll(async () => {
    oldDays = (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { unsignedFollowUpDays: true } }))?.unsignedFollowUpDays ?? 3;
    await prisma.user.createMany({ data: [
      { id: ownerId, email: tag + "-o@example.test", name: "W19 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: tag + "-s@example.test", name: "W19 Staff", role: "STAFF", emailVerified: true },
      { id: custUserId, email: tag + "-c@example.test", name: "Pat Renter", role: "CUSTOMER", emailVerified: true } ] });
    await prisma.customer.create({ data: { id: customerId, userId: custUserId, referralCode: "W" + tag.slice(0, 18) } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    await prisma.applianceType.create({ data: { id: typeId, name: "Washer " + tag, slug: "w19-washer-" + tag, monthlyPriceCents: 3500 } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { unsignedFollowUpDays: 3 } });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { unsignedFollowUpDays: oldDays } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: agreementIds } }, { userId: { in: [ownerId, custUserId] } }] } });
    await prisma.job.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { customerId } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, custUserId] } } });
  });

  it("the unsigned reminder setting starts at 3, validates, audits, rejects stale saves and non-owners", async () => {
    expect(await getUnsignedFollowUpDays()).toBe(3);
    await expect(saveUnsignedFollowUpDays(ownerId, 0, 3)).rejects.toThrow(/1 to 30/);
    await expect(saveUnsignedFollowUpDays(ownerId, 31, 3)).rejects.toThrow(/1 to 30/);
    await expect(saveUnsignedFollowUpDays(staffId, 5, 3)).rejects.toThrow();
    await saveUnsignedFollowUpDays(ownerId, 5, 3);
    expect(await getUnsignedFollowUpDays()).toBe(5);
    await expect(saveUnsignedFollowUpDays(ownerId, 6, 3)).rejects.toThrow(/another session/);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "agreement.unsigned_follow_up_days.update" } })).toBe(1);
    await saveUnsignedFollowUpDays(ownerId, 3, 5);
  });

  it("an agreement unsigned past the setting gets one named To do that links to it and clears when signed", async () => {
    const old = await agreement({ status: "AWAITING_SIGNATURE" });
    const fresh = await agreement({ status: "AWAITING_SIGNATURE" });
    const signed = await agreement({ status: "AWAITING_SIGNATURE" });
    await prisma.signatureRecord.create({ data: { agreementId: old.id, provider: "test", createdAt: new Date(now.getTime() - 4 * DAY) } });
    await prisma.signatureRecord.create({ data: { agreementId: fresh.id, provider: "test", createdAt: new Date(now.getTime() - 1 * DAY) } });
    await prisma.signatureRecord.create({ data: { agreementId: signed.id, provider: "test", createdAt: new Date(now.getTime() - 9 * DAY), signedAt: now } });
    const rows = (await listUnsignedAgreements(50, now)).rows;
    expect(mine(rows, old.id)).toHaveLength(1);
    expect(mine(rows, old.id)[0]).toMatchObject({ category: "UNSIGNED_AGREEMENT", title: "Follow up: Pat Renter hasn't signed", href: "/desk/agreements/" + old.id });
    expect(mine(rows, fresh.id)).toHaveLength(0);
    expect(mine(rows, signed.id)).toHaveLength(0);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { unsignedFollowUpDays: 1 } });
    expect(mine((await listUnsignedAgreements(50, now)).rows, fresh.id)).toHaveLength(1); // a shorter setting reminds sooner
    await prisma.rentalAgreement.update({ where: { id: old.id }, data: { status: "CANCELLED" } });
    expect(mine((await listUnsignedAgreements(50, now)).rows, old.id)).toHaveLength(0);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { unsignedFollowUpDays: 3 } });
  });

  it("a rental ended with appliances still out gets one draft pickup visit and a To do; a repeat adds no second", async () => {
    const a = await agreement();
    await heldAppliance(a.id);
    await prisma.$transaction((tx) => closeAgreementInTx(tx, ownerId, a.id, "ENDED"));
    const jobs = await prisma.job.findMany({ where: { agreementId: a.id, type: "REMOVAL" }, include: { appliances: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].scheduledAt).toBeNull();
    expect(jobs[0].appliances).toHaveLength(1);
    const todo = (await listPickupUnscheduled(50)).rows.find((r) => r.href === "/desk/jobs/" + jobs[0].id);
    expect(todo?.title).toBe("Schedule Pat Renter's pickup");
    const again = await createPickupVisitForAgreement(ownerId, a.id);
    expect(again).toEqual({ jobId: jobs[0].id, created: false });
    expect(await prisma.job.count({ where: { agreementId: a.id, type: "REMOVAL" } })).toBe(1);
  });

  it("a rental ended with everything already returned gets no pickup", async () => {
    const a = await agreement();
    await prisma.$transaction((tx) => closeAgreementInTx(tx, ownerId, a.id, "ENDED"));
    expect(await prisma.job.count({ where: { agreementId: a.id, type: "REMOVAL" } })).toBe(0);
    await expect(createPickupVisitForAgreement(ownerId, a.id)).rejects.toThrow(/nothing to pick up/);
  });

  it("an ended or ending rental with appliances out and no visit shows a To do to the agreement page, and the button fixes it", async () => {
    const a = await agreement({ terminationRequestedAt: now, terminationEffectiveOn: new Date(now.getTime() + 5 * DAY) });
    await heldAppliance(a.id);
    expect((await agreementIdsNeedingPickup(now, 200)).some((r) => r.id === a.id)).toBe(true);
    const row = (await listPickupUnscheduled(50)).rows.find((r) => r.href === "/desk/agreements/" + a.id);
    expect(row).toMatchObject({ category: "PICKUP_UNSCHEDULED", title: "Schedule Pat Renter's pickup" });
    await expect(createPickupVisitForAgreement(staffId, a.id)).rejects.toThrow();
    const made = await createPickupVisitForAgreement(ownerId, a.id);
    expect(made.created).toBe(true);
    expect((await agreementIdsNeedingPickup(now, 200)).some((r) => r.id === a.id)).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "agreement.pickup_visit_created" } })).toBe(1);
  });

  it("a customer's pickup request becomes a draft pickup visit, never a repair request, and only for their own rental", async () => {
    const a = await agreement();
    const applianceId = await heldAppliance(a.id);
    const before = await prisma.maintenanceRequest.count({ where: { customerId } });
    const result = (await createPickupRequestForUser(custUserId, { note: "Moving out Friday", applianceId }))!;
    expect(result.created).toBe(true);
    expect(await prisma.maintenanceRequest.count({ where: { customerId } })).toBe(before);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job).toMatchObject({ type: "REMOVAL", status: "SCHEDULED", scheduledAt: null, agreementId: a.id });
    expect(job.notes).toContain("Customer asked for a pickup");
    expect(job.notes).toContain("Moving out Friday");
    const again = await createPickupRequestForUser(custUserId, { note: "Also the dryer", applianceId });
    expect(await getPortalPickupRequests(custUserId)).toEqual([expect.objectContaining({ id: result.jobId, text: "Pickup request: Moving out Friday" })]);
    expect(again).toEqual({ jobId: result.jobId, created: false });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: result.jobId } })).notes).toContain("Also the dryer");
    // Several rentals have appliances out, so it cannot pick one: the caller files an ordinary request for review instead.
    expect(await createPickupRequestForUser(custUserId, { note: "which one?" })).toBeNull();
    await expect(createPickupRequestForUser(staffId, { note: "x" })).rejects.toThrow(/No customer account/);
    await expect(createPickupRequestForUser(custUserId, { note: "x", applianceId: "not-mine" })).rejects.toThrow(/isn't on one of your active rentals/);
  });
});
