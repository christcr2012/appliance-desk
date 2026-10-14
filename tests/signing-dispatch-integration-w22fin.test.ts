import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateJobStatus } from "@/domains/jobs";

const uri = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const disposable = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";

describe.skipIf(!disposable)("W-22FIN signed delivery dispatch guard on disposable PostgreSQL", () => {
  const tag = "w22-start-" + randomUUID().replaceAll("-", "");
  const fingerprint = "c".repeat(64);
  const signedAt = new Date("2026-10-14T13:00:00Z");
  let ownerId: string, customerId: string, addressId: string, agreementId: string, jobId: string;
  let foreignCustomerId: string, foreignUserId: string, userId: string;
  let receiptId: string | null = null;

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    userId = (await prisma.user.create({ data: {
      email: tag + "@test.invalid", role: "CUSTOMER", emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: "D" + tag.slice(-15),
    } })).id;
    foreignUserId = (await prisma.user.create({ data: {
      email: "foreign-" + tag + "@test.invalid", role: "CUSTOMER", emailVerified: true,
    } })).id;
    foreignCustomerId = (await prisma.customer.create({ data: {
      userId: foreignUserId, referralCode: "F" + tag.slice(-15),
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "1 Dispatch Proof St", city: "Greeley", state: "CO", zip: "80631",
    } })).id;
    agreementId = (await prisma.rentalAgreement.create({ data: {
      customerId, serviceAddressId: addressId, status: "ACTIVE",
    } })).id;
    await prisma.signatureRecord.create({ data: {
      agreementId, provider: "test", signedAt,
      signingOrderFingerprint: fingerprint,
      signingAllInCents: 4800, signingEvidenceVersion: 1,
    } });
    jobId = (await prisma.job.create({ data: {
      type: "DELIVERY", status: "SCHEDULED",
      customerId, agreementId, serviceAddressId: addressId,
    } })).id;
  });

  afterAll(async () => {
    if (jobId) await prisma.auditLog.deleteMany({ where: { entityType: "Job", entityId: jobId } });
    if (jobId) await prisma.job.deleteMany({ where: { id: jobId } });
    if (agreementId) {
      await prisma.agreementSigningPayment.deleteMany({ where: { agreementId } });
      await prisma.signatureRecord.deleteMany({ where: { agreementId } });
      await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    }
    if (receiptId) await prisma.receipt.deleteMany({ where: { id: receiptId } });
    if (addressId) await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (foreignCustomerId) await prisma.customer.deleteMany({ where: { id: foreignCustomerId } });
    if (foreignUserId) await prisma.user.deleteMany({ where: { id: foreignUserId } });
  });

  it("denies a physical start without a signed obligation and while payment is pending", async () => {
    await expect(updateJobStatus(ownerId, jobId, "IN_PROGRESS"))
      .rejects.toThrow(/payment review/i);
    await prisma.agreementSigningPayment.create({ data: {
      agreementId, orderFingerprint: fingerprint, evidenceVersion: 1,
      setupFeeCents: 4500, setupTaxCents: 300, downPaymentCents: 0,
      totalCents: 4800, status: "AWAITING_PAYMENT", signedAt,
    } });
    await expect(updateJobStatus(ownerId, jobId, "IN_PROGRESS"))
      .rejects.toThrow(/actually received/i);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status)
      .toBe("SCHEDULED");
  });

  it("denies foreign and short receipts, then permits one genuinely matched settled start", async () => {
    const rcpt = await prisma.receipt.create({ data: {
      customerId: foreignCustomerId, source: "MANUAL",
      amountCents: 4800, method: "check", receivedOn: signedAt,
    } });
    receiptId = rcpt.id;
    await prisma.agreementSigningPayment.update({ where: { agreementId }, data: {
      status: "SETTLED", receiptId,
    } });
    await expect(updateJobStatus(ownerId, jobId, "IN_PROGRESS"))
      .rejects.toThrow(/actually received/i);
    await prisma.receipt.update({ where: { id: receiptId }, data: {
      customerId, amountCents: 4799,
    } });
    await expect(updateJobStatus(ownerId, jobId, "IN_PROGRESS"))
      .rejects.toThrow(/actually received/i);
    await prisma.receipt.update({ where: { id: receiptId }, data: {
      amountCents: 4800,
    } });
    const started = await updateJobStatus(ownerId, jobId, "IN_PROGRESS");
    expect(started.status).toBe("IN_PROGRESS");
    await expect(updateJobStatus(ownerId, jobId, "IN_PROGRESS"))
      .rejects.toThrow(/already/i);
    expect(await prisma.auditLog.count({ where: {
      entityType: "Job", entityId: jobId, action: "job.status",
    } })).toBe(1);
    expect(await prisma.invoice.count({ where: { agreementId } })).toBe(0);
  });
});
