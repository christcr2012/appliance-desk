// PLAN scenario 8 (BATCH-F WU-F3): a customer asks for a copy of their data and then for deletion. The export contains that
// customer's records only (including the bill still unpaid); the deletion is confirmed through the emailed link, removes the
// personal details but keeps what the law and open money require; the request records who fulfilled it and when; another
// customer's data is untouched. Email and private photo storage are faked. Disposable database only.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; text: string }> }));
vi.mock("@/lib/customer-email", () => ({
  sendCustomerEmail: async (message: { to: string; text: string }) => {
    mail.sent.push({ to: message.to, text: message.text });
    return { sent: true, outcome: "SENT" as const, providerMessageId: `sc8-${randomUUID()}` };
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ sent: true }), getEmailAcceptedAt: async () => null }));
vi.mock("@/lib/photo-storage", () => ({ getPrivatePhotoStore: () => ({ token: "private-test-token", storeId: "store_test" }) }));
vi.mock("@/domains/backup/media-deletion", () => ({ deletePrivatePhotoWithRecovery: async () => undefined }));

import { prisma } from "@/lib/prisma";
import { buildPrivacyExport, fulfillPrivacyDeletion, openPrivacyRequest, verifyPrivacyRequest, markPrivacyExportFulfilled } from "@/domains/privacy";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("scenario 8: privacy export and deletion with retention", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `sc8-owner-${tag}`;
  const userA = `sc8-user-a-${tag}`;
  const userB = `sc8-user-b-${tag}`;
  const customerA = `sc8-customer-a-${tag}`;
  const customerB = `sc8-customer-b-${tag}`;
  const addressA = `sc8-address-a-${tag}`;
  const addressB = `sc8-address-b-${tag}`;
  const agreementA = `sc8-agreement-a-${tag}`;
  const emailA = `${tag}-a@example.test`;
  const emailB = `${tag}-b@example.test`;
  const requestIds: string[] = [];

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${tag}-owner@example.test`, name: "SC8 Owner", role: "OWNER", emailVerified: true },
      { id: userA, email: emailA, name: `Person A ${tag}`, role: "CUSTOMER", emailVerified: true },
      { id: userB, email: emailB, name: `Person B ${tag}`, role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.createMany({ data: [
      { id: customerA, userId: userA, phone: "9705550201", companyName: `Private A ${tag}`, referralCode: `SA${tag.slice(0, 14)}` },
      { id: customerB, userId: userB, phone: "9705550202", companyName: `Private B ${tag}`, referralCode: `SB${tag.slice(0, 14)}` },
    ] });
    await prisma.serviceAddress.createMany({ data: [
      { id: addressA, customerId: customerA, line1: `111 A ${tag}`, city: "Greeley", state: "CO", zip: "80631" },
      { id: addressB, customerId: customerB, line1: `222 B ${tag}`, city: "Greeley", state: "CO", zip: "80631" },
    ] });
    await prisma.rentalAgreement.create({ data: { id: agreementA, customerId: customerA, serviceAddressId: addressA, status: "ACTIVE" } });
    // Customer A owes money (an OPEN bill) and has paid another; both are kept after deletion.
    await prisma.invoice.create({ data: { customerId: customerA, agreementId: agreementA, status: "OPEN", amountDueCents: 6000, amountPaidCents: 0, lineItems: { create: { kind: "RENTAL", description: `A-open-${tag}`, amountCents: 6000 } } } });
    const paid = await prisma.invoice.create({ data: { customerId: customerA, agreementId: agreementA, status: "PAID", amountDueCents: 4000, amountPaidCents: 4000, lineItems: { create: { kind: "RENTAL", description: `A-paid-${tag}`, amountCents: 4000 } } } });
    await prisma.payment.create({ data: { invoiceId: paid.id, amountCents: 4000, method: "check", status: "SUCCEEDED" } });
    await prisma.receipt.create({ data: { customerId: customerA, source: "MANUAL", amountCents: 4000, method: "check", receivedOn: new Date() } });
    await prisma.customerNotice.create({ data: { customerId: customerA, kind: "TEST", dedupeKey: `sc8-notice-${tag}`, subject: "Notice", body: `retained notice ${tag}` } });
    await prisma.documentArtifact.create({ data: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: agreementA, customerId: customerA, payload: { tag }, html: `<html>${tag}</html>`, sha256: sha(`<html>${tag}</html>`), rendererVersion: 1 } });
    await prisma.auditLog.create({ data: { userId: ownerId, action: "privacy.fixture", entityType: "Customer", entityId: customerA, newValue: { tag } } });
    await prisma.invoice.create({ data: { customerId: customerB, status: "OPEN", amountDueCents: 1234, lineItems: { create: { kind: "RENTAL", description: `B-only-${tag}`, amountCents: 1234 } } } });
    await prisma.session.create({ data: { userId: userA, token: `sc8-session-${tag}`, expiresAt: new Date(Date.now() + 86_400_000) } });
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    const both = [customerA, customerB];
    await prisma.privacyRequest.deleteMany({ where: { OR: [{ customerId: { in: both } }, { requesterEmail: { contains: tag } }] } });
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { in: requestIds.map((id) => `privacy-verification-${id}`) } } });
    await prisma.documentArtifact.deleteMany({ where: { customerId: { in: both } } });
    await prisma.customerNotice.deleteMany({ where: { customerId: { in: both } } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId: { in: both } } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId: { in: both } } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: both } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: both } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: both } }, { userId: ownerId }] } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId: { in: both } } });
    await prisma.session.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: both } } });
    await prisma.customer.deleteMany({ where: { id: { in: both } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userA, userB] } } });
  });

  it("a signed-in customer's export request lists that customer's records only, including the open bill", async () => {
    const opened = await openPrivacyRequest({ kind: "EXPORT", email: emailA, customerId: customerA, ipKey: `sc8-${tag}` });
    requestIds.push(opened.requestId);
    expect(opened.verification).toBe("SESSION");
    // Someone else's email cannot be used on this customer's session path.
    await expect(openPrivacyRequest({ kind: "EXPORT", email: emailB, customerId: customerA, ipKey: `sc8-${tag}` })).rejects.toThrow(/does not match/);

    const json = JSON.parse((await buildPrivacyExport(ownerId, opened.requestId)).toString("utf8"));
    const text = JSON.stringify(json);
    expect(json.customer.id).toBe(customerA);
    expect(text).toContain(`A-open-${tag}`);
    expect(text).toContain(`A-paid-${tag}`);
    expect(json.invoices.map((i: { amountDueCents: number }) => i.amountDueCents).sort()).toEqual([4000, 6000]);
    expect(text).not.toContain(`B-only-${tag}`);
    expect(text).not.toContain(`222 B ${tag}`);
    expect(text).not.toContain(emailB);

    // Only the owner can produce it, and it is closed once, recording who did it.
    await expect(buildPrivacyExport(userA, opened.requestId)).rejects.toThrow(/Owner access/);
    await markPrivacyExportFulfilled(ownerId, opened.requestId);
    await expect(markPrivacyExportFulfilled(ownerId, opened.requestId)).rejects.toThrow();
    expect(await prisma.privacyRequest.findUniqueOrThrow({ where: { id: opened.requestId } })).toMatchObject({ status: "FULFILLED", fulfilledByUserId: ownerId });
  });

  it("a public deletion request must be confirmed from the emailed link before anything is removed", async () => {
    const opened = await openPrivacyRequest({ kind: "DELETE", email: emailA.toUpperCase(), ipKey: `sc8-pub-${tag}` });
    requestIds.push(opened.requestId);
    expect(opened.verification).toBe("EMAIL_SENT");
    const message = mail.sent.find((m) => m.to === emailA && m.text.includes(opened.requestId))!;
    const token = new URL(message.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    await expect(fulfillPrivacyDeletion(ownerId, opened.requestId, "DELETE")).rejects.toThrow(/Verify the customer's identity/);
    await expect(verifyPrivacyRequest(opened.requestId, "wrong-token")).rejects.toThrow(/invalid or expired/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).email).toBe(emailA); // nothing happened yet
    await verifyPrivacyRequest(opened.requestId, token);
    await expect(verifyPrivacyRequest(opened.requestId, token)).rejects.toThrow(); // the link works once

    await expect(fulfillPrivacyDeletion(ownerId, opened.requestId, "delete" as "DELETE")).rejects.toThrow(/Type DELETE/);
    // With a rental in force and a bill still owed, the deletion is refused and nothing changes.
    await expect(fulfillPrivacyDeletion(ownerId, opened.requestId, "DELETE")).rejects.toThrow(/rental in force or an unpaid bill/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).email).toBe(emailA);
    // The owner ends the rental and writes the bill off; now the deletion can go ahead.
    await prisma.rentalAgreement.update({ where: { id: agreementA }, data: { status: "ENDED" } });
    await prisma.invoice.updateMany({ where: { customerId: customerA, status: "OPEN" }, data: { status: "WRITTEN_OFF" } });
    const before = {
      invoices: await prisma.invoice.count({ where: { customerId: customerA } }),
      payments: await prisma.payment.count({ where: { invoice: { customerId: customerA } } }),
      receipts: await prisma.receipt.count({ where: { customerId: customerA } }),
      notices: await prisma.customerNotice.count({ where: { customerId: customerA } }),
      artifacts: await prisma.documentArtifact.count({ where: { customerId: customerA } }),
      audit: await prisma.auditLog.count({ where: { entityId: customerA } }),
      other: await prisma.invoice.count({ where: { customerId: customerB } }),
    };
    const result = await fulfillPrivacyDeletion(ownerId, opened.requestId, "DELETE");
    expect(result.retained).toEqual(expect.arrayContaining(["Invoice", "Payment", "Receipt", "AuditLog"]));

    // Personal details are gone and the login is closed...
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userA } })).toMatchObject({ email: `deleted-${userA}@invalid`, name: "Deleted customer" });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customerA } })).toMatchObject({ phone: null, companyName: null });
    expect((await prisma.serviceAddress.findUniqueOrThrow({ where: { id: addressA } })).line1).toBe("Deleted address");
    expect(await prisma.session.count({ where: { userId: userA } })).toBe(0);
    // ...while money, signatures, notices and the audit history stay, including the written-off bill.
    expect(await prisma.invoice.count({ where: { customerId: customerA } })).toBe(before.invoices);
    expect(await prisma.invoice.findFirstOrThrow({ where: { customerId: customerA, status: "WRITTEN_OFF" } })).toMatchObject({ amountDueCents: 6000, amountPaidCents: 0 });
    expect(await prisma.payment.count({ where: { invoice: { customerId: customerA } } })).toBe(before.payments);
    expect(await prisma.receipt.count({ where: { customerId: customerA } })).toBe(before.receipts);
    expect(await prisma.customerNotice.count({ where: { customerId: customerA } })).toBe(before.notices);
    expect(await prisma.documentArtifact.count({ where: { customerId: customerA } })).toBe(before.artifacts);
    expect(await prisma.auditLog.count({ where: { entityId: customerA } })).toBe(before.audit);

    // The request says who did it and when; a repeat changes nothing; the other customer is untouched.
    const done = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: opened.requestId } });
    expect(done).toMatchObject({ status: "FULFILLED", fulfilledByUserId: ownerId });
    expect(done.fulfilledAt).toBeInstanceOf(Date);
    expect(done.requesterEmail).toBe(`deleted-${userA}@invalid`);
    await expect(fulfillPrivacyDeletion(ownerId, opened.requestId, "DELETE")).resolves.toEqual(result);
    // The completed deletion is on the audit trail once (ids only), and the repeat did not add a second row.
    const trail = await prisma.auditLog.findMany({ where: { entityId: opened.requestId, action: "privacy.deletion_fulfilled" } });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ userId: ownerId, newValue: { customerId: customerA } });
    expect(await prisma.invoice.count({ where: { customerId: customerB } })).toBe(before.other);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userB } })).toMatchObject({ email: emailB, name: `Person B ${tag}` });
    expect((await prisma.serviceAddress.findUniqueOrThrow({ where: { id: addressB } })).line1).toBe(`222 B ${tag}`);
  });

  it("a request from an address with no account is never auto-verified, and a non-owner cannot fulfil anything", async () => {
    const stranger = await openPrivacyRequest({ kind: "EXPORT", email: `nobody-${tag}@example.test`, ipKey: `sc8-stranger-${tag}` });
    requestIds.push(stranger.requestId);
    expect(stranger.verification).toBe("OWNER_WILL_CALL");
    expect((await prisma.privacyRequest.findUniqueOrThrow({ where: { id: stranger.requestId } })).status).not.toBe("VERIFIED");
    await expect(fulfillPrivacyDeletion(userB, stranger.requestId, "DELETE")).rejects.toThrow(/Owner access/);
  });
});
