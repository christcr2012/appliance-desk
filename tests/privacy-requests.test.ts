import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const email = vi.hoisted(() => vi.fn(async () => ({ sent: true, outcome: "SENT" as const })));
const deletePrivatePhoto = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: email }));
vi.mock("@/lib/photo-storage", () => ({
  getPrivatePhotoStore: () => ({ token: "private-test-token", storeId: "store_test" }),
}));
vi.mock("@/domains/backup/media-deletion", () => ({
  deletePrivatePhotoWithRecovery: (
    sourceUrl: string,
    store: { token: string; storeId: string },
  ) => deletePrivatePhoto(sourceUrl, store),
}));

import { prisma } from "@/lib/prisma";
import {
  buildPrivacyExport,
  fulfillPrivacyDeletion,
  openPrivacyRequest,
  verifyPrivacyRequest,
} from "@/domains/privacy";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  databaseUrl.pathname === "/appliance_desk_test";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!enabled)("Batch D privacy requests (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `privacy-owner-${tag}`;
  const userA = `privacy-user-a-${tag}`;
  const userB = `privacy-user-b-${tag}`;
  const customerA = `privacy-customer-a-${tag}`;
  const customerB = `privacy-customer-b-${tag}`;
  const addressA = `privacy-address-a-${tag}`;
  const addressB = `privacy-address-b-${tag}`;
  const agreementA = `privacy-agreement-a-${tag}`;
  const invoiceA = `privacy-invoice-a-${tag}`;
  const maintenanceA = `privacy-maint-${tag}`;
  const deletionRequest = `privacy-delete-${tag}`;
  const exportRequest = `privacy-export-${tag}`;
  const rateKey = `privacy-rate-${tag}`;
  const privatePhotoUrl = `https://store-test.private.blob.vercel-storage.com/maintenance-requests/${maintenanceA}/${tag}.jpg`;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ownerId, email: `${tag}-owner@example.test`, role: "OWNER", emailVerified: true },
      { id: userA, email: `${tag}-a@example.test`, name: `Person A ${tag}`, role: "CUSTOMER", emailVerified: true },
      { id: userB, email: `${tag}-b@example.test`, name: `Person B ${tag}`, role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.createMany({ data: [
      { id: customerA, userId: userA, phone: "9705550101", companyName: `Private A ${tag}`, referralCode: `PRA${tag.slice(0, 12)}` },
      { id: customerB, userId: userB, phone: "9705550102", companyName: `Private B ${tag}`, referralCode: `PRB${tag.slice(0, 12)}` },
    ] });
    await prisma.serviceAddress.createMany({ data: [
      { id: addressA, customerId: customerA, line1: `111 A ${tag}`, city: "Greeley", state: "CO", zip: "80631" },
      { id: addressB, customerId: customerB, line1: `222 B ${tag}`, city: "Greeley", state: "CO", zip: "80631" },
    ] });
    await prisma.customerContact.create({ data: { customerId: customerA, name: `Contact ${tag}`, phone: "9705550199", email: `${tag}-contact@example.test`, notes: "private note" } });
    await prisma.lead.create({ data: { contactName: `Lead ${tag}`, phone: "9705550188", email: `${tag}-a@example.test`, addressLine1: `333 Lead ${tag}`, convertedCustomerId: customerA } });
    await prisma.session.create({ data: { userId: userA, token: `privacy-session-${tag}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.rentalAgreement.create({ data: { id: agreementA, customerId: customerA, serviceAddressId: addressA, status: "ACTIVE" } });
    await prisma.signatureRecord.create({ data: { agreementId: agreementA, provider: "typed_signature", signerName: `Person A ${tag}`, signerEmail: `${tag}-a@example.test`, signedAt: new Date() } });
    await prisma.invoice.create({ data: { id: invoiceA, customerId: customerA, agreementId: agreementA, status: "PAID", amountDueCents: 5000, amountPaidCents: 5000, lineItems: { create: { kind: "RENTAL", description: `A invoice ${tag}`, amountCents: 5000 } } } });
    await prisma.payment.create({ data: { invoiceId: invoiceA, amountCents: 5000, method: "card", status: "SUCCEEDED" } });
    await prisma.receipt.create({ data: { customerId: customerA, source: "MANUAL", amountCents: 5000, method: "cash", receivedOn: new Date() } });
    await prisma.customerCredit.create({ data: { customerId: customerA, amountCents: 1000, remainingCents: 1000, reason: "test" } });
    await prisma.customerNotice.create({ data: { customerId: customerA, kind: "TEST", dedupeKey: `privacy-notice-${tag}`, subject: "Notice", body: `retained notice ${tag}` } });
    await prisma.documentArtifact.create({ data: { kind: "SIGNED_AGREEMENT", subjectType: "RentalAgreement", subjectId: agreementA, customerId: customerA, payload: { tag }, html: `<html>${tag}</html>`, sha256: sha(`<html>${tag}</html>`), rendererVersion: 1 } });
    await prisma.auditLog.create({ data: { userId: ownerId, action: "privacy.fixture", entityType: "Customer", entityId: customerA, newValue: { tag } } });
    await prisma.maintenanceRequest.create({ data: { id: maintenanceA, customerId: customerA, problem: `private photo ${tag}` } });
    await prisma.photo.create({ data: { url: privatePhotoUrl, maintenanceRequestId: maintenanceA } });
    await prisma.privacyRequest.create({ data: { id: deletionRequest, kind: "DELETE", status: "VERIFIED", customerId: customerA, requesterEmail: `${tag}-a@example.test`, verifiedAt: new Date() } });
    await prisma.privacyRequest.create({ data: { id: exportRequest, kind: "EXPORT", status: "VERIFIED", customerId: customerB, requesterEmail: `${tag}-b@example.test`, verifiedAt: new Date() } });
    await prisma.invoice.create({ data: { customerId: customerB, status: "OPEN", amountDueCents: 1234, lineItems: { create: { kind: "RENTAL", description: `B-only-${tag}`, amountCents: 1234 } } } });
  });

  afterAll(async () => {
    await prisma.verification.deleteMany({ where: { identifier: { startsWith: "rate-limit:" } } });
    await prisma.photo.deleteMany({ where: { maintenanceRequestId: maintenanceA } });
    await prisma.maintenanceRequest.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.documentArtifact.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customerNotice.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId: { in: [customerA, customerB] } } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId: { in: [customerA, customerB] } } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customerCredit.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: customerA }, { entityId: customerB }, { userId: ownerId }] } });
    await prisma.signatureRecord.deleteMany({ where: { agreementId: agreementA } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.privacyRequest.deleteMany({ where: { OR: [{ customerId: { in: [customerA, customerB] } }, { requesterEmail: { contains: tag } }] } });
    await prisma.customerContact.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.lead.deleteMany({ where: { OR: [{ convertedCustomerId: customerA }, { convertedCustomerId: customerB }, { email: { contains: tag } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userA, userB] } } });
  });

  it("exports only the requested customer's rows", async () => {
    const json = JSON.parse((await buildPrivacyExport(ownerId, exportRequest)).toString("utf8"));
    expect(json.customer.id).toBe(customerB);
    expect(JSON.stringify(json)).toContain(`B-only-${tag}`);
    expect(JSON.stringify(json)).not.toContain(`A invoice ${tag}`);
    expect(JSON.stringify(json)).not.toContain(`111 A ${tag}`);
  });

  it("recovers from Blob failure, then pseudonymizes personal data and retains evidence", async () => {
    deletePrivatePhoto.mockClear();
    const before = {
      invoice: await prisma.invoice.count({ where: { customerId: customerA } }),
      payment: await prisma.payment.count({ where: { invoice: { customerId: customerA } } }),
      receipt: await prisma.receipt.count({ where: { customerId: customerA } }),
      signature: await prisma.signatureRecord.count({ where: { agreementId: agreementA } }),
      artifact: await prisma.documentArtifact.count({ where: { customerId: customerA } }),
      notice: await prisma.customerNotice.count({ where: { customerId: customerA } }),
      audit: await prisma.auditLog.count({ where: { entityId: customerA } }),
    };

    deletePrivatePhoto.mockRejectedValueOnce(new Error("private blob unavailable"));
    await expect(fulfillPrivacyDeletion(ownerId, deletionRequest, "DELETE")).rejects.toThrow(/blob unavailable/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).email).toBe(`${tag}-a@example.test`);
    expect(await prisma.photo.count({ where: { maintenanceRequestId: maintenanceA } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: userA } })).toBe(0);
    expect(await prisma.privacyRequest.findUniqueOrThrow({ where: { id: deletionRequest } })).toMatchObject({
      status: "VERIFIED",
      fulfilledByUserId: ownerId,
    });

    const result = await fulfillPrivacyDeletion(ownerId, deletionRequest, "DELETE");
    expect(result.retained).toContain("Invoice");
    expect(deletePrivatePhoto).toHaveBeenLastCalledWith(
      privatePhotoUrl,
      { token: "private-test-token", storeId: "store_test" },
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userA } })).email).toBe(`deleted-${userA}@invalid`);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerA } })).phone).toBeNull();
    expect((await prisma.serviceAddress.findUniqueOrThrow({ where: { id: addressA } })).line1).toBe("Deleted address");
    expect((await prisma.customerContact.findFirstOrThrow({ where: { customerId: customerA } })).name).toBe("Deleted customer");
    expect((await prisma.lead.findFirstOrThrow({ where: { convertedCustomerId: customerA } })).contactName).toBe("Deleted customer");
    expect(await prisma.photo.count({ where: { maintenanceRequestId: maintenanceA } })).toBe(0);
    expect(await prisma.invoice.count({ where: { customerId: customerA } })).toBe(before.invoice);
    expect(await prisma.payment.count({ where: { invoice: { customerId: customerA } } })).toBe(before.payment);
    expect(await prisma.receipt.count({ where: { customerId: customerA } })).toBe(before.receipt);
    expect(await prisma.signatureRecord.count({ where: { agreementId: agreementA } })).toBe(before.signature);
    expect(await prisma.documentArtifact.count({ where: { customerId: customerA } })).toBe(before.artifact);
    expect(await prisma.customerNotice.count({ where: { customerId: customerA } })).toBe(before.notice);
    expect(await prisma.auditLog.count({ where: { entityId: customerA } })).toBe(before.audit);
    await expect(fulfillPrivacyDeletion(ownerId, deletionRequest, "DELETE")).resolves.toEqual(result);
    expect(deletePrivatePhoto).toHaveBeenCalledTimes(2);
  });

  it("refuses expired and reused verification tokens", async () => {
    const expired = `privacy-expired-${tag}`;
    await prisma.privacyRequest.create({ data: { id: expired, kind: "EXPORT", customerId: customerB, requesterEmail: `${tag}-b@example.test`, verificationTokenHash: sha("expired-token"), verificationExpiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyPrivacyRequest(expired, "expired-token")).rejects.toThrow(/invalid or expired/i);

    const live = `privacy-live-${tag}`;
    await prisma.privacyRequest.create({ data: { id: live, kind: "EXPORT", customerId: customerB, requesterEmail: `${tag}-b@example.test`, verificationTokenHash: sha("live-token"), verificationExpiresAt: new Date(Date.now() + 60_000) } });
    await verifyPrivacyRequest(live, "live-token");
    await expect(verifyPrivacyRequest(live, "live-token")).rejects.toThrow(/invalid or expired/i);
  });

  it("enforces five public requests per hour for one key", async () => {
    for (let i = 0; i < 5; i += 1) {
      await openPrivacyRequest({ kind: "EXPORT", email: `${tag}-unknown-${i}@example.test`, ipKey: rateKey });
    }
    await expect(openPrivacyRequest({ kind: "EXPORT", email: `${tag}-unknown-6@example.test`, ipKey: rateKey })).rejects.toThrow(/too many/i);
  });

  it("public known and unknown emails both use the same neutral page response path", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/app/(public)/privacy/actions.ts", "utf8"));
    expect(source.match(/redirect\("\/privacy\?request=received"\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/customerId|EMAIL_SENT|OWNER_WILL_CALL/);
  });
});
