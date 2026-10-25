import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TelecomSmsProvider } from "@/lib/communications/providers/types";
import { getWorkflowTextPreview, recordStaffTextConsent, sendWorkflowText } from "@/domains/messaging/workflow-text";
import {
  approveWorkflowWording, confirmWorkflowLegalReview, getWorkflowTextSettings, setWorkflowTextEnabled,
} from "@/domains/messaging/workflow-text-settings";
import { workflowTextFamily } from "@/domains/messaging/workflow-text-catalog";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("COM-N1C billing, renewal and refund texts (isolated PostgreSQL)", () => {
  const name = "n1c-" + randomUUID().slice(0, 8);
  const owner = name + "-owner", staff = name + "-staff", custUser = name + "-cu";
  const accountId = name + "-acct", numberId = name + "-num", customerId = name + "-cust", addressId = name + "-addr";
  const openInv = name + "-open", paidInv = name + "-paid", refundInv = name + "-refund", draftInv = name + "-draft";
  const soonAgreement = name + "-soon", farAgreement = name + "-far";
  const recipient = "+13035550177";
  const noon = new Date("2026-10-20T18:00:00Z");
  const keyBefore = process.env.COMMUNICATION_CONTENT_KEY;
  let old: { customerSmsEnabled: boolean; communicationsPolicy: unknown; communicationsPolicyVersion: number };
  let version = 0; let n = 0;
  const token = () => `tok${String(++n).padStart(8, "0")}`;
  const fake = (): TelecomSmsProvider => ({
    sendSms: vi.fn(async () => ({ kind: "ACCEPTED" as const, resourceId: "SM" + randomBytes(16).toString("hex") })) });
  const send = async (actor: string, family: string, subjectId: string, provider: TelecomSmsProvider) => {
    const p = await getWorkflowTextPreview(actor, family, subjectId, noon);
    return sendWorkflowText(actor, { family, subjectId, clientToken: token(), expectedTextHash: p.textHash ?? "none" },
      { provider, callbackOrigin: "https://example.test", now: noon });
  };
  const codes = async (family: string, id: string) => (await getWorkflowTextPreview(owner, family, id, noon)).blockers.map((b) => b.code);
  const approve = async (key: string) => { await approveWorkflowWording(owner, { family: key, body: workflowTextFamily(key)!.defaultBody }); };
  const enable = async (key: string) => { version = (await setWorkflowTextEnabled(owner, { family: key, enabled: true, expectedVersion: version })).version; };

  beforeAll(async () => {
    process.env.COMMUNICATION_CONTENT_KEY = randomBytes(32).toString("base64");
    old = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" },
      select: { customerSmsEnabled: true, communicationsPolicy: true, communicationsPolicyVersion: true } });
    for (const [id, role] of [[owner, "OWNER"], [staff, "STAFF"], [custUser, "CUSTOMER"]] as const) {
      await prisma.user.create({ data: { id, email: id + "@example.test", role, name: id === custUser ? "Morgan Lee" : undefined } });
    }
    await prisma.customer.create({ data: { id: customerId, userId: custUser, referralCode: name, phone: "303-555-0177" } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    await prisma.telecomAccount.create({ data: { id: accountId, environment: "TEST", provider: "twilio", externalAccountId: name, label: "TEST only", status: "READY" } });
    await prisma.businessPhoneNumber.create({ data: { id: numberId, accountId, address: "+13035550199", providerNumberId: numberId,
      capabilities: { sms: true, voice: false }, verifiedAt: new Date(), registrationStatus: "APPROVED" } });
    await prisma.invoice.create({ data: { id: openInv, customerId, status: "OPEN", amountDueCents: 6000, amountPaidCents: 0 } });
    await prisma.invoice.create({ data: { id: draftInv, customerId, status: "DRAFT", amountDueCents: 6000 } });
    await prisma.invoice.create({ data: { id: paidInv, customerId, status: "PAID", amountDueCents: 6000, amountPaidCents: 6000 } });
    await prisma.invoice.create({ data: { id: refundInv, customerId, status: "REFUNDED", amountDueCents: 6000, amountPaidCents: 6000 } });
    await prisma.refund.create({ data: { invoiceId: refundInv, amountCents: 125050, reason: "GOODWILL" } });
    const agreement = (id: string, endDate: Date) => prisma.rentalAgreement.create({ data: { id, customerId, serviceAddressId: addressId,
      status: "ACTIVE", termMonths: 12, startDate: new Date("2025-11-08T07:00:00Z"), endDate, termsSnapshot: {} } });
    await agreement(soonAgreement, new Date("2026-11-30T07:00:00Z"));
    await agreement(farAgreement, new Date("2027-08-30T07:00:00Z"));
    version = old.communicationsPolicyVersion + 1;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: true, communicationsPolicyVersion: version,
      communicationsPolicy: { schemaVersion: 1, manualSmsEnabled: true, primaryAccountId: accountId, primaryNumberId: numberId,
        approvedPolicyVersion: version, maxSegments: 3, supportedCountries: ["US"] } } });
  });

  afterAll(async () => {
    const threads = await prisma.communicationThread.findMany({ where: { accountId }, select: { id: true } });
    const tids = threads.map((t) => t.id);
    await prisma.communicationLink.deleteMany({ where: { message: { threadId: { in: tids } } } });
    await prisma.communicationMessage.deleteMany({ where: { threadId: { in: tids } } });
    const deliveries = await prisma.messageDelivery.findMany({ where: { subjectId: { in: tids } }, select: { id: true } });
    const dids = deliveries.map((d) => d.id);
    await prisma.messageDelivery.updateMany({ where: { id: { in: dids } }, data: { currentAttemptId: null } });
    await prisma.messageAttempt.deleteMany({ where: { deliveryId: { in: dids } } });
    await prisma.messageDelivery.deleteMany({ where: { id: { in: dids } } });
    const points = await prisma.contactPoint.findMany({ where: { address: recipient, environment: "TEST" }, select: { id: true } });
    const pids = points.map((p) => p.id);
    await prisma.communicationThread.deleteMany({ where: { externalContactPointId: { in: pids } } });
    await prisma.consentRecord.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactBinding.deleteMany({ where: { contactPointId: { in: pids } } });
    await prisma.contactPoint.deleteMany({ where: { id: { in: pids } } });
    await prisma.communicationTemplateRevision.updateMany({ where: { createdByUserId: owner }, data: { isCurrent: false } });
    await prisma.communicationTemplateRevision.deleteMany({ where: { createdByUserId: owner, deliveries: { none: {} } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: [soonAgreement, farAgreement] } } });
    await prisma.refund.deleteMany({ where: { invoiceId: refundInv } });
    await prisma.invoice.deleteMany({ where: { id: { in: [openInv, paidInv, refundInv, draftInv] } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.businessPhoneNumber.deleteMany({ where: { id: numberId } });
    await prisma.telecomAccount.deleteMany({ where: { id: accountId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, staff, custUser] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff, custUser] } } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerSmsEnabled: old.customerSmsEnabled,
      communicationsPolicy: old.communicationsPolicy as object, communicationsPolicyVersion: old.communicationsPolicyVersion } });
    if (keyBefore === undefined) delete process.env.COMMUNICATION_CONTENT_KEY; else process.env.COMMUNICATION_CONTENT_KEY = keyBefore;
  });

  it("staff and customers can never use billing texts", async () => {
    await expect(getWorkflowTextPreview(staff, "invoice_ready", openInv, noon)).rejects.toThrow();
    await expect(getWorkflowTextPreview(custUser, "invoice_ready", openInv, noon)).rejects.toThrow();
    await expect(confirmWorkflowLegalReview(staff, { family: "refund_issued", reviewed: true, expectedVersion: version })).rejects.toThrow();
  });

  it("wording that needs a professional's review cannot be switched on until the Owner confirms the review", async () => {
    for (const key of ["invoice_ready", "invoice_reminder", "payment_received", "refund_issued", "renewal_heads_up"]) await approve(key);
    const settings = await getWorkflowTextSettings(owner);
    const reviewKeys = settings.families.filter((f) => f.needsLegalReview).map((f) => f.key).sort();
    expect(reviewKeys).toEqual(["invoice_reminder", "refund_issued", "renewal_heads_up"]);
    await expect(setWorkflowTextEnabled(owner, { family: "refund_issued", enabled: true, expectedVersion: version })).rejects.toThrow(/professional/);
    await expect(confirmWorkflowLegalReview(owner, { family: "invoice_ready", reviewed: true, expectedVersion: version })).rejects.toThrow();
    version = (await confirmWorkflowLegalReview(owner, { family: "refund_issued", reviewed: true, expectedVersion: version })).version;
    await enable("refund_issued");
    const after = (await getWorkflowTextSettings(owner)).families.find((f) => f.key === "refund_issued")!;
    expect(after).toMatchObject({ enabled: true, legalReviewed: true });
  });

  it("changing reviewed wording clears the review and switches the text off", async () => {
    await approveWorkflowWording(owner, { family: "refund_issued",
      body: "Robinson Appliance Rentals: Hi {{name}}, your refund of {{amount}} for invoice #{{number}} was issued. Reply STOP to opt out." });
    const f = (await getWorkflowTextSettings(owner)).families.find((x) => x.key === "refund_issued")!;
    expect(f).toMatchObject({ enabled: false, legalReviewed: false });
    version = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { communicationsPolicyVersion: true } })).communicationsPolicyVersion;
    expect(await codes("refund_issued", refundInv)).toEqual(expect.arrayContaining(["FAMILY_OFF"]));
    version = (await confirmWorkflowLegalReview(owner, { family: "refund_issued", reviewed: true, expectedVersion: version })).version;
    await enable("refund_issued");
  });

  it("an unreviewed policy flag cannot slip through at the last moment", async () => {
    await enable("invoice_ready");
    await enable("payment_received");
    version = (await confirmWorkflowLegalReview(owner, { family: "renewal_heads_up", reviewed: true, expectedVersion: version })).version;
    await enable("renewal_heads_up");
    // invoice_reminder is approved but neither reviewed nor on
    const blockers = await codes("invoice_reminder", openInv);
    expect(blockers).toEqual(expect.arrayContaining(["FAMILY_OFF"]));
  });

  it("each text only fits the right invoice or agreement state", async () => {
    expect(await codes("invoice_ready", draftInv)).toContain("WRONG_STATE");
    expect(await codes("invoice_ready", paidInv)).toContain("WRONG_STATE");
    expect(await codes("payment_received", openInv)).toContain("WRONG_STATE");
    expect(await codes("refund_issued", openInv)).toContain("WRONG_STATE");
    expect(await codes("renewal_heads_up", farAgreement)).toContain("WRONG_STATE");
  });

  it("with permission recorded, billing texts go out one at a time, filed on the right record", async () => {
    await recordStaffTextConsent(owner, { principal: { customerId }, method: "WRITTEN" }, noon);
    const provider = fake();
    const ready = await send(owner, "invoice_ready", openInv, provider);
    expect(ready.kind).toBe("ACCEPTED");
    const texts = () => vi.mocked(provider.sendSms).mock.calls.map((c) => c[0].text);
    expect(texts()[0]).toMatch(/invoice #\d+ is ready\. Sign in to view it: http.*\/account\/billing\/invoice\//);
    expect(texts()[0]).not.toMatch(/\$|60\.00/); // no amounts in a bill-ready text
    expect((await send(owner, "payment_received", paidInv, provider)).kind).toBe("ACCEPTED");
    expect((await send(owner, "refund_issued", refundInv, provider)).kind).toBe("ACCEPTED");
    expect(texts()[2]).toContain("$1,250.50");
    expect((await send(owner, "renewal_heads_up", soonAgreement, provider)).kind).toBe("ACCEPTED");
    expect(texts()[3]).toMatch(/term ends on Nov 30, 2026/);
    expect(provider.sendSms).toHaveBeenCalledTimes(4);
    for (const [type, id] of [["Invoice", openInv], ["Invoice", paidInv], ["Invoice", refundInv], ["RentalAgreement", soonAgreement]] as const) {
      expect(await prisma.communicationLink.count({ where: { entityType: type, entityId: id } })).toBe(1);
    }
  });

  it("master switch off or review removed stops the next text", async () => {
    version = (await confirmWorkflowLegalReview(owner, { family: "refund_issued", reviewed: false, expectedVersion: version })).version;
    const provider = fake();
    const r = await send(owner, "refund_issued", refundInv, provider);
    expect(r.kind).toBe("BLOCKED");
    expect(provider.sendSms).not.toHaveBeenCalled();
  });
});
