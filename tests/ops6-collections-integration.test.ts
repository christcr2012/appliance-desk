import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// A fake message path: real email stays off in tests, and the point here is WHEN a message is attempted.
const sent = vi.hoisted(() => ({ calls: [] as Array<{ key: string; to: string }>, state: "ACCEPTED" as string }));
vi.mock("@/domains/messaging/deliver", () => ({
  deliverMessage: vi.fn(async (input: { idempotencyKey: string; recipient: { address: string } }) => {
    sent.calls.push({ key: input.idempotencyKey, to: input.recipient.address });
    return { state: sent.state, deliveryId: `del-${input.idempotencyKey}`, providerMessageId: null };
  }),
}));

import { runCollectionsPass } from "@/domains/collections/engine";
import {
  createCollectionPickup, customerObjected, recordCourtOrder, recordDecision, recordPickupConsent,
  recordSmallClaimsFiling, saveLadder, saveNoticeWording, sendNotice, skipNotice,
} from "@/domains/collections/actions";
import { gatherSmallClaimsFacts } from "@/domains/collections/packet";
import { listCollectionAttention } from "@/domains/exceptions/collection-attention";

// OPS-6 on real Postgres.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";
const DAY = 86_400_000;

describe.skipIf(!enabled)("collections (real Postgres, fake message path)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const ownerId = `ops6-owner-${tag}`;
  const staffId = `ops6-staff-${tag}`;
  const custUser = `ops6-cust-${tag}`;
  let customerId = "";
  let addressId = "";
  let agreementId = "";
  let invoiceId = "";
  let applianceId = "";
  let typeId = "";
  const now = new Date();

  beforeAll(async () => {
    for (const [id, role] of [[ownerId, "OWNER"], [staffId, "STAFF"], [custUser, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.test`, name: `OPS6 ${role}`, role, emailVerified: true } });
    }
    customerId = (await prisma.customer.create({ data: { userId: custUser, referralCode: `O6${tag}` } })).id;
    addressId = (await prisma.serviceAddress.create({ data: { customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } })).id;
    typeId = (await prisma.applianceType.create({ data: { name: `Washer ops6 ${tag}`, slug: `ops6-washer-${tag}` } })).id;
    applianceId = (await prisma.appliance.create({ data: { assetNumber: `OPS6-${tag}`, applianceTypeId: typeId, status: "RENTED", acquisitionCostCents: 40_000 } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: { customerId, serviceAddressId: addressId, status: "ACTIVE", startDate: new Date(now.getTime() - 90 * DAY) } })).id;
    await prisma.applianceCustodyEpisode.create({ data: { applianceId, agreementId, customerId, startedOn: new Date(now.getTime() - 90 * DAY), startEvidence: "MANUAL" } });
    invoiceId = (await prisma.invoice.create({
      data: { customerId, agreementId, status: "OPEN", amountDueCents: 12_500, amountPaidCents: 0, dueDate: new Date(now.getTime() - 35 * DAY) },
    })).id;
  });

  beforeEach(() => { sent.calls.length = 0; sent.state = "ACCEPTED"; });

  afterAll(async () => {
    await prisma.collectionStep.deleteMany({ where: { customerId } });
    await prisma.smallClaimsFiling.deleteMany({ where: { agreementId } });
    const kase = await prisma.collectionCase.findUnique({ where: { agreementId } });
    await prisma.collectionCase.deleteMany({ where: { agreementId } });
    await prisma.jobAppliance.deleteMany({ where: { job: { agreementId } } });
    await prisma.job.deleteMany({ where: { agreementId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: [ownerId, staffId] } }, ...(kase ? [{ entityId: kase.id }] : [])] } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { agreementId } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId, custUser] } } });
  });

  it("prepares the second notice, final notice and decision once, and sends nothing", async () => {
    await runCollectionsPass(now);
    await runCollectionsPass(now); // a second night: still one of each
    const steps = await prisma.collectionStep.findMany({ where: { invoiceId }, orderBy: { kind: "asc" } });
    expect(steps.map((s) => s.kind).sort()).toEqual(["DECISION", "FINAL_NOTICE", "SECOND_NOTICE"]);
    expect(steps.every((s) => s.state === "WAITING")).toBe(true);
    expect(steps.find((s) => s.kind === "SECOND_NOTICE")?.body).toContain("Robinson Appliance Rentals");
    expect(sent.calls).toHaveLength(0); // nothing reaches a customer by itself
    expect(await prisma.collectionCase.count({ where: { agreementId } })).toBe(1);
    const todo = await listCollectionAttention(500, now);
    expect(todo.rows.filter((r) => r.title.includes("OPS6")).length).toBeGreaterThanOrEqual(3);
  });

  it("sends a notice only when approved, once, and records it", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "SECOND_NOTICE" } });
    await expect(sendNotice(staffId, step.id)).rejects.toThrow();
    const first = await sendNotice(ownerId, step.id);
    expect(first.sent).toBe(true);
    expect(sent.calls).toEqual([{ key: `collection-${step.id}`, to: `${custUser}@example.test` }]);
    await expect(sendNotice(ownerId, step.id)).rejects.toThrow(/already handled/);
    expect((await prisma.collectionStep.findUniqueOrThrow({ where: { id: step.id } })).state).toBe("SENT");
  });

  it("keeps a notice waiting when the message path did not send it (live email off)", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "FINAL_NOTICE" } });
    sent.state = "NOT_SENT";
    const result = await sendNotice(ownerId, step.id);
    expect(result.sent).toBe(false);
    expect((await prisma.collectionStep.findUniqueOrThrow({ where: { id: step.id } })).state).toBe("WAITING");
  });

  it("does not call an uncertain or pending message \"sent\"", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "FINAL_NOTICE" } });
    for (const state of ["UNKNOWN", "PENDING"]) {
      sent.state = state;
      const result = await sendNotice(ownerId, step.id);
      expect(result.sent).toBe(false);
      expect(result.message).toMatch(/can't confirm/i);
      const after = await prisma.collectionStep.findUniqueOrThrow({ where: { id: step.id } });
      expect(after.state).toBe("WAITING");
      expect(after.deliveryId).toBe(`del-collection-${step.id}`);
    }
  });

  it("rewrites a waiting notice with the new balance after a part payment, and asks to read it again", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "FINAL_NOTICE" } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaidCents: 10_000 } });
    await expect(sendNotice(ownerId, step.id)).rejects.toThrow(/paid part|new amount/i);
    const after = await prisma.collectionStep.findUniqueOrThrow({ where: { id: step.id } });
    expect(after.amountOwedCents).toBe(2_500);
    expect(after.body).toContain("$25.00");
    expect(after.body).not.toContain("$125.00");
    expect(sent.calls).toHaveLength(0);
    await prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaidCents: 0 } });
  });

  it("saves notice wording as an owner setting, refuses ownership language, and uses it in new notices only", async () => {
    await expect(saveNoticeWording(staffId, { payHowText: "Pay at the shop.", helpText: "" })).rejects.toThrow();
    await expect(saveNoticeWording(ownerId, { payHowText: "Keep paying and you will own it.", helpText: "" })).rejects.toThrow(/own/i);
    await saveNoticeWording(ownerId, { payHowText: "Pay at our shop on 8th Street.", helpText: "" });
    const row = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.collectionPayHowText).toBe("Pay at our shop on 8th Street.");
    await saveNoticeWording(ownerId, { payHowText: "", helpText: "" });
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).collectionPayHowText).toBeNull();
  });

  it("needs a reason to skip a notice", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "FINAL_NOTICE" } });
    await expect(skipNotice(ownerId, step.id, "  ")).rejects.toThrow(/why/);
  });

  it("never picks up without the customer's recorded agreement, and never from active duty without a court order", async () => {
    await expect(createCollectionPickup(ownerId, agreementId)).rejects.toThrow(/agreed/);
    await prisma.customer.update({ where: { id: customerId }, data: { activeMilitary: true } });
    await recordPickupConsent(ownerId, agreementId, { how: "Phone call on Friday" });
    await expect(createCollectionPickup(ownerId, agreementId)).rejects.toThrow(/military|court order/i);
    expect(await prisma.job.count({ where: { agreementId, type: "REMOVAL" } })).toBe(0);
    await recordCourtOrder(ownerId, agreementId, { orderedOn: new Date(now.getTime() - DAY), note: "Weld County Court 26C123" });
    const { jobId } = await createCollectionPickup(ownerId, agreementId);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.type).toBe("REMOVAL");
    expect(job.notes).toMatch(/stop and leave/i);
    await prisma.customer.update({ where: { id: customerId }, data: { activeMilitary: false } });
  });

  it("ends the visit when the customer objects and brings up small claims", async () => {
    await customerObjected(staffId, agreementId, "Said no at the door");
    const kase = await prisma.collectionCase.findUniqueOrThrow({ where: { agreementId } });
    expect(kase.objectedAt).not.toBeNull();
    const job = await prisma.job.findUniqueOrThrow({ where: { id: kase.pickupJobId! } });
    expect(job.status).toBe("CANCELLED");
    expect(job.outcomeNotes).toMatch(/nothing taken/i);
    expect(await prisma.collectionStep.count({ where: { invoiceId, kind: "SMALL_CLAIMS", state: "WAITING" } })).toBe(1);
    await customerObjected(staffId, agreementId, "again"); // repeat is harmless
    expect(await prisma.collectionStep.count({ where: { invoiceId, kind: "SMALL_CLAIMS" } })).toBe(1);
  });

  it("records the day-30 decision once", async () => {
    const step = await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "DECISION" } });
    await expect(recordDecision(ownerId, step.id, "PAYMENT_PLAN", "")).rejects.toThrow(/plan/);
    await recordDecision(ownerId, step.id, "PAYMENT_PLAN", "$50 on the 1st and 15th");
    await expect(recordDecision(ownerId, step.id, "WAIT", "")).rejects.toThrow(/already/);
  });

  it("reads the small-claims limit and fee from the rule book and counts filings per county", async () => {
    const facts = await gatherSmallClaimsFacts(agreementId, "Weld", now);
    expect(facts.limitCents).toBe(750_000);
    expect(facts.feeCents).toBe(3_100); // $125.00 owed is under $500, so the lower fee applies
    expect(facts.owedCents).toBe(12_500);
    expect(facts.appliances).toEqual([{ label: `OPS6-${tag}`, costCents: 40_000 }]);
    await recordSmallClaimsFiling(ownerId, { agreementId, county: "OPS6 County", filedOn: now, amountCents: 12_500, feeCents: 3_100 });
    await recordSmallClaimsFiling(ownerId, { agreementId, county: "OPS6 County", filedOn: now, amountCents: 12_500, feeCents: 3_100 });
    const blocked = await gatherSmallClaimsFacts(agreementId, "OPS6 County", now);
    expect(blocked.eligible.ok).toBe(false);
    expect(blocked.eligible.reason).toMatch(/this month/);
    expect(await prisma.collectionStep.count({ where: { invoiceId, kind: "SMALL_CLAIMS", state: "WAITING" } })).toBe(0); // filing closes the step
  });

  it("closes waiting steps when the bill is paid, and rejects a bad ladder", async () => {
    await prisma.collectionStep.updateMany({ where: { invoiceId, kind: "FINAL_NOTICE" }, data: { state: "WAITING" } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaidCents: 12_500, status: "PAID" } });
    await runCollectionsPass(now);
    expect((await prisma.collectionStep.findFirstOrThrow({ where: { invoiceId, kind: "FINAL_NOTICE" } })).state).toBe("SKIPPED");
    await expect(saveLadder(ownerId, { secondNotice: 20, finalNotice: 10, decision: 30 })).rejects.toThrow(/before/);
    await expect(saveLadder(staffId, { secondNotice: 10, finalNotice: 20, decision: 30 })).rejects.toThrow();
  });
});
