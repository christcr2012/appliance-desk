import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ requireRole: vi.fn(async () => ({ user: { id: "test-owner", role: "OWNER" } })) }));
import { prisma } from "@/lib/prisma";
import { ensurePickupDraftInTx, decideEndingPickup } from "@/domains/agreements/pickup-draft";
import { ensureSignedDeliveryDraftInTx } from "@/domains/agreements/signed-delivery";
import { getRentalEndingNoticeDays, saveRentalEndingNoticeDays } from "@/domains/agreements/ending-notice";
import { listSignedDeliveryAttention, dayAfterSigning } from "@/domains/exceptions/signed-delivery-attention";
import { listRentalEndingSoon, listPickupUnscheduled, listVisitNeedsAssignment } from "@/domains/exceptions/turning-points-attention";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("W-4 rental turning points on real PostgreSQL", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "w4-owner-" + tag, staffId = "w4-staff-" + tag, custUserId = "w4-cu-" + tag, customerId = "w4-c-" + tag, addressId = "w4-a-" + tag;
  const agreementIds: string[] = [];
  let oldDays = 30;
  const now = new Date();

  async function agreement(extra: Record<string, unknown> = {}) {
    const a = await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12, startDate: new Date(now.getTime() - 300 * DAY),
      endDate: new Date(now.getTime() + 10 * DAY), depositCents: 0, damageWaiverCents: 0, lateFeeGraceDays: 7, lateFeeCents: 0,
      lateFeePercent: 0, taxRateMilliPercent: 0, ...extra } });
    agreementIds.push(a.id);
    return a;
  }
  const mine = <T extends { href: string }>(rows: T[], id: string) => rows.filter((r) => r.href.includes(id));

  beforeAll(async () => {
    oldDays = (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { rentalEndingNoticeDays: true } }))?.rentalEndingNoticeDays ?? 30;
    await prisma.user.createMany({ data: [
      { id: ownerId, email: tag + "-o@example.test", name: "W4 Owner", role: "OWNER", emailVerified: true },
      { id: staffId, email: tag + "-s@example.test", name: "W4 Staff", role: "STAFF", emailVerified: true },
      { id: custUserId, email: tag + "-c@example.test", name: "Pat Renter", role: "CUSTOMER", emailVerified: true } ] });
    await prisma.customer.create({ data: { id: customerId, userId: custUserId, referralCode: "W" + tag.slice(0, 18) } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { rentalEndingNoticeDays: oldDays } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: agreementIds } }, { userId: ownerId }] } });
    await prisma.job.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { renewedFromAgreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, custUserId] } } });
  });

  it("a signed rental's delivery To do is named for the customer and due the next business day", async () => {
    const a = await agreement({ endDate: new Date(now.getTime() + 300 * DAY) });
    const signedAt = new Date(now.getTime() - 3600_000);
    await prisma.signatureRecord.create({ data: { agreementId: a.id, provider: "test", signedAt } });
    await prisma.$transaction((tx) => ensureSignedDeliveryDraftInTx(tx, { id: a.id, customerId, serviceAddressId: addressId, renewedFromAgreementId: null }));
    const rows = mine((await listSignedDeliveryAttention(50)).rows, "/desk/jobs/");
    const row = (await listSignedDeliveryAttention(50)).rows.find((r) => r.title === "Schedule Pat Renter's delivery");
    expect(row).toBeTruthy();
    expect(row!.dueOn).toEqual(dayAfterSigning(signedAt));
    expect(row!.dueDateOnly).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the ending reminder setting defaults to 30, validates, audits and rejects stale saves", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { rentalEndingNoticeDays: 30 } });
    expect(await getRentalEndingNoticeDays()).toBe(30);
    await expect(saveRentalEndingNoticeDays(ownerId, 0, 30)).rejects.toThrow(/1 to 365/);
    await expect(saveRentalEndingNoticeDays(ownerId, 366, 30)).rejects.toThrow(/1 to 365/);
    await expect(saveRentalEndingNoticeDays(staffId, 14, 30)).rejects.toThrow();
    await saveRentalEndingNoticeDays(ownerId, 14, 30);
    expect(await getRentalEndingNoticeDays()).toBe(14);
    await expect(saveRentalEndingNoticeDays(ownerId, 20, 30)).rejects.toThrow(/another session/);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: "agreement.ending_notice_days.update" } })).toBe(1);
    await saveRentalEndingNoticeDays(ownerId, 30, 14);
  });

  it("a rental ending inside the window gets exactly one To do; outside it, renewed or already ending gets none", async () => {
    const inside = await agreement({ endDate: new Date(now.getTime() + 20 * DAY) });
    const outside = await agreement({ endDate: new Date(now.getTime() + 90 * DAY) });
    const ending = await agreement({ terminationRequestedAt: now, terminationEffectiveOn: new Date(now.getTime() + 5 * DAY) });
    const renewed = await agreement({ endDate: new Date(now.getTime() + 15 * DAY) });
    await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "DRAFT", renewedFromAgreementId: renewed.id, depositCents: 0, damageWaiverCents: 0, lateFeeGraceDays: 7, lateFeeCents: 0, lateFeePercent: 0, taxRateMilliPercent: 0 } });
    const rows = (await listRentalEndingSoon(50, now)).rows;
    expect(mine(rows, inside.id)).toHaveLength(1);
    expect(mine(rows, inside.id)[0]).toMatchObject({ category: "RENTAL_ENDING_SOON", title: "Pat Renter's rental is ending soon", href: "/desk/agreements/" + inside.id + "/ending-decision" });
    for (const other of [outside, ending, renewed]) expect(mine(rows, other.id)).toHaveLength(0);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { rentalEndingNoticeDays: 120 } });
    expect(mine((await listRentalEndingSoon(50, now)).rows, outside.id)).toHaveLength(1);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { rentalEndingNoticeDays: 30 } });
  });

  it("choosing Pickup creates exactly one unscheduled draft pickup, a To do, and a repeat creates no second", async () => {
    const a = await agreement({ endDate: new Date(now.getTime() + 25 * DAY) });
    const first = await decideEndingPickup(ownerId, a.id);
    const again = await decideEndingPickup(ownerId, a.id);
    expect(first.created).toBe(true);
    expect(again).toEqual({ jobId: first.jobId, created: false });
    const jobs = await prisma.job.findMany({ where: { agreementId: a.id, type: "REMOVAL" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "SCHEDULED", scheduledAt: null, assignedToUserId: null });
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "agreement.ending_pickup_chosen" } })).toBe(1);
    const todo = (await listPickupUnscheduled(50)).rows.find((r) => r.href === "/desk/jobs/" + first.jobId);
    expect(todo).toMatchObject({ category: "PICKUP_UNSCHEDULED", title: "Schedule Pat Renter's pickup" });
    expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(0);
    // the ending decision hides the "ending soon" row
    expect(mine((await listRentalEndingSoon(50, now)).rows, a.id)).toHaveLength(1); // fixed-term pickup keeps the rental ACTIVE until its date
  });

  it("refuses Pickup for the wrong rentals and for non-staff", async () => {
    const mtm = await agreement({ termMonths: null, endDate: null });
    await expect(decideEndingPickup(ownerId, mtm.id)).rejects.toThrow(/fixed-term/);
    const ended = await agreement({ status: "ENDED" });
    await expect(decideEndingPickup(ownerId, ended.id)).rejects.toThrow(/active/);
    const live = await agreement();
    await expect(decideEndingPickup(custUserId, live.id)).rejects.toThrow();
    const renewedAlready = await agreement();
    await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "DRAFT", renewedFromAgreementId: renewedAlready.id, depositCents: 0, damageWaiverCents: 0, lateFeeGraceDays: 7, lateFeeCents: 0, lateFeePercent: 0, taxRateMilliPercent: 0 } });
    await expect(decideEndingPickup(ownerId, renewedAlready.id)).rejects.toThrow(/renewal/);
    expect(await prisma.job.count({ where: { agreementId: { in: [mtm.id, ended.id, live.id, renewedAlready.id] } } })).toBe(0);
  });

  it("the pickup draft is not created for an ended rental and links the machines the customer holds", async () => {
    const a = await agreement();
    const type = await prisma.applianceType.findFirst({ select: { id: true } });
    if (!type) return;
    const appliance = await prisma.appliance.create({ data: { applianceTypeId: type.id, serialNumber: "W4-" + tag } as never });
    await prisma.applianceCustodyEpisode.create({ data: { applianceId: appliance.id, customerId, agreementId: a.id, startedOn: now, startEvidence: "DELIVERY_JOB" as never } as never });
    const id = await prisma.$transaction((tx) => ensurePickupDraftInTx(tx, a.id));
    expect((await prisma.jobAppliance.findMany({ where: { jobId: id! } })).map((j) => j.applianceId)).toEqual([appliance.id]);
    await prisma.jobAppliance.deleteMany({ where: { jobId: id! } });
    await prisma.job.deleteMany({ where: { id: id! } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: appliance.id } });
    await prisma.appliance.delete({ where: { id: appliance.id } });
    const ended = await agreement({ status: "ENDED" });
    expect(await prisma.$transaction((tx) => ensurePickupDraftInTx(tx, ended.id))).toBeNull();
  });

  it("flags a visit within 2 days with nobody assigned, and a pickup needed within 2 days with no time", async () => {
    const a = await agreement();
    const soon = await prisma.job.create({ data: { type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: new Date(now.getTime() + DAY), customerId, agreementId: a.id } });
    const assigned = await prisma.job.create({ data: { type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: new Date(now.getTime() + DAY), customerId, agreementId: a.id, assignedToUserId: staffId } });
    const far = await prisma.job.create({ data: { type: "MAINTENANCE_VISIT", status: "SCHEDULED", scheduledAt: new Date(now.getTime() + 6 * DAY), customerId, agreementId: a.id } });
    const b = await agreement({ endDate: new Date(now.getTime() + DAY) });
    const pickup = await prisma.job.create({ data: { type: "REMOVAL", status: "SCHEDULED", scheduledAt: null, customerId, agreementId: b.id } });
    const rows = (await listVisitNeedsAssignment(50, now)).rows;
    expect(rows.find((r) => r.href.endsWith(soon.id))).toMatchObject({ category: "VISIT_NEEDS_ASSIGNMENT", title: "Assign / set a time — Pat Renter" });
    expect(rows.find((r) => r.href.endsWith(pickup.id))).toMatchObject({ title: "Assign / set a time — Pat Renter" });
    for (const j of [assigned, far]) expect(rows.find((r) => r.href.endsWith(j.id))).toBeUndefined();
  });
});
