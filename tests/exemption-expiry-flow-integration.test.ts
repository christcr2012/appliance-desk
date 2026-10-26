import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { createCustomerTaxExemption } from "@/domains/tax/exemptions";
import { listExpiredExemptionAttention } from "@/domains/tax/filing-attention";

function databaseUri(): URL | null {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
}
const uri = databaseUri();
const enabled = process.env.CI === "true" && uri !== null &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
const daysAgo = (count: number) =>
  day(businessDateKey(new Date(Date.now() - count * 24 * 3600 * 1000)));

describe.skipIf(!enabled)("TFA-2 §9 exemption expiry flow on real Postgres", () => {
  it("shows the expired-certificate To do only for billed customers with no current certificate", async () => {
    const tag = randomUUID().slice(0, 8);
    const ownerId = "tfa2-ex-owner-" + tag;
    const billedUser = "tfa2-ex-u1-" + tag;
    const quietUser = "tfa2-ex-u2-" + tag;
    const billedCustomer = "tfa2-ex-c1-" + tag;
    const quietCustomer = "tfa2-ex-c2-" + tag;
    const jurisdictionId = "tfa2-ex-jur-" + tag;
    try {
      await prisma.user.createMany({
        data: [
          { id: ownerId, email: tag + "-owner@example.test", name: "Ex Owner", role: "OWNER", emailVerified: true },
          { id: billedUser, email: tag + "-billed@example.test", name: "Billed Customer", role: "CUSTOMER", emailVerified: true },
          { id: quietUser, email: tag + "-quiet@example.test", name: "Quiet Customer", role: "CUSTOMER", emailVerified: true },
        ],
      });
      await prisma.customer.createMany({
        data: [
          { id: billedCustomer, userId: billedUser, referralCode: "B" + tag },
          { id: quietCustomer, userId: quietUser, referralCode: "Q" + tag },
        ],
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "E9-" + tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2025-01-01"), source: "MANUAL" },
      });
      // Both certificates expired 40 days ago; only one customer was billed since.
      for (const customerId of [billedCustomer, quietCustomer]) {
        await prisma.customerTaxExemption.create({
          data: {
            customerId, reason: "CHARITABLE", certificatePhotoId: "photo-" + tag,
            jurisdictionIds: [jurisdictionId],
            validFrom: day("2025-01-01"), expiresOn: daysAgo(40),
            verifiedByUserId: ownerId,
          },
        });
      }
      const invoice = await prisma.invoice.create({
        data: {
          customerId: billedCustomer, status: "PAID",
          issuedAt: daysAgo(10), amountDueCents: 10500,
        },
      });
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: invoice.id, jurisdictionId, rateVersionId: rate.id,
          category: "RENTAL", taxableCents: 10000, taxCents: 500, source: "ENGINE",
        },
      });

      const now = new Date();
      const mine = (await listExpiredExemptionAttention(now))
        .filter((item) => item.todoKey?.includes(billedCustomer) || item.todoKey?.includes(quietCustomer));
      expect(mine.map((item) => item.todoKey)).toEqual([
        `exemption-expired:${billedCustomer}:${businessDateKey(daysAgo(40))}`,
      ]);
      expect(mine[0]!.title).toContain("Billed Customer");
      expect(mine[0]!.detail).toContain("DR 0715");

      // A current certificate on file clears the To do.
      await createCustomerTaxExemption(ownerId, billedCustomer, {
        reason: "CHARITABLE", certificatePhotoId: "photo-new-" + tag,
        jurisdictionIds: [jurisdictionId], validFrom: day(businessDateKey(now)),
      });
      const after = (await listExpiredExemptionAttention(now))
        .filter((item) => item.todoKey?.includes(billedCustomer));
      expect(after).toHaveLength(0);
    } finally {
      await prisma.customerCredit.deleteMany({ where: { customerId: { in: [billedCustomer, quietCustomer] } } });
      await prisma.invoiceTaxLine.deleteMany({ where: { jurisdictionId } });
      await prisma.invoice.deleteMany({ where: { customerId: { in: [billedCustomer, quietCustomer] } } });
      await prisma.customerTaxExemption.deleteMany({ where: { customerId: { in: [billedCustomer, quietCustomer] } } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.customer.deleteMany({ where: { id: { in: [billedCustomer, quietCustomer] } } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, billedUser, quietUser] } } });
    }
  });

  it("credits tax charged since a back-dated certificate took effect, for its areas only", async () => {
    const tag = randomUUID().slice(0, 8);
    const ownerId = "tfa2-ex2-owner-" + tag;
    const userId = "tfa2-ex2-user-" + tag;
    const customerId = "tfa2-ex2-customer-" + tag;
    const jurA = "tfa2-ex2-ja-" + tag;
    const jurB = "tfa2-ex2-jb-" + tag;
    try {
      await prisma.user.createMany({
        data: [
          { id: ownerId, email: tag + "-owner2@example.test", name: "Ex Owner", role: "OWNER", emailVerified: true },
          { id: userId, email: tag + "-customer2@example.test", name: "Credit Customer", role: "CUSTOMER", emailVerified: true },
        ],
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: "C" + tag },
      });
      for (const [jurisdictionId, level] of [[jurA, "STATE"], [jurB, "CITY"]] as const) {
        await prisma.taxJurisdiction.create({
          data: {
            id: jurisdictionId, code: "E9" + level + "-" + tag, name: "Test " + level,
            level, administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
          },
        });
        await prisma.taxRateVersion.create({
          data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2025-01-01"), source: "MANUAL" },
        });
      }
      const rates = await prisma.taxRateVersion.findMany({ where: { jurisdictionId: { in: [jurA, jurB] } } });
      const rateFor = (jurisdictionId: string) => rates.find((r) => r.jurisdictionId === jurisdictionId)!.id;
      async function taxedInvoice(issuedAt: Date, jurisdictionId: string, taxCents: number) {
        const invoice = await prisma.invoice.create({
          data: { customerId, status: "PAID", issuedAt, amountDueCents: 10000 + taxCents },
        });
        await prisma.invoiceTaxLine.create({
          data: {
            invoiceId: invoice.id, jurisdictionId, rateVersionId: rateFor(jurisdictionId),
            category: "RENTAL", taxableCents: 10000, taxCents, source: "ENGINE",
          },
        });
      }
      await taxedInvoice(daysAgo(20), jurA, 700); // in the window, covered area: credited
      await taxedInvoice(daysAgo(20), jurB, 300); // in the window, other area: not credited
      await taxedInvoice(daysAgo(90), jurA, 999); // before the certificate took effect: not credited

      const exemption = await createCustomerTaxExemption(ownerId, customerId, {
        reason: "GOVERNMENT", certificatePhotoId: "photo-" + tag,
        jurisdictionIds: [jurA], validFrom: daysAgo(30),
      });
      const credits = await prisma.customerCredit.findMany({ where: { customerId } });
      expect(credits).toHaveLength(1);
      expect(credits[0]).toMatchObject({
        amountCents: 700, remainingCents: 700,
        sourceType: "EXEMPTION_BACKDATE", sourceId: exemption.id,
      });
      expect(await prisma.auditLog.count({
        where: { action: "tax.exemption.backdate_credit", entityId: credits[0]!.id },
      })).toBe(1);

      // A certificate that starts today creates no back-dated credit.
      const second = "tfa2-ex2-customer2-" + tag;
      const secondUser = "tfa2-ex2-user2-" + tag;
      await prisma.user.create({
        data: { id: secondUser, email: tag + "-c3@example.test", name: "Fresh Customer", role: "CUSTOMER", emailVerified: true },
      });
      await prisma.customer.create({ data: { id: second, userId: secondUser, referralCode: "F" + tag } });
      const fresh = await prisma.invoice.create({
        data: { customerId: second, status: "PAID", issuedAt: daysAgo(5), amountDueCents: 10400 },
      });
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: fresh.id, jurisdictionId: jurA, rateVersionId: rateFor(jurA),
          category: "RENTAL", taxableCents: 10000, taxCents: 400, source: "ENGINE",
        },
      });
      await createCustomerTaxExemption(ownerId, second, {
        reason: "RESALE", certificatePhotoId: "photo-" + tag,
        jurisdictionIds: [jurA], validFrom: day(businessDateKey(new Date())),
      });
      expect(await prisma.customerCredit.count({ where: { customerId: second } })).toBe(0);
      await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: fresh.id } });
      await prisma.invoice.deleteMany({ where: { id: fresh.id } });
      await prisma.customerTaxExemption.deleteMany({ where: { customerId: second } });
      await prisma.customer.deleteMany({ where: { id: second } });
      await prisma.user.deleteMany({ where: { id: secondUser } });
    } finally {
      await prisma.customerCredit.deleteMany({ where: { customerId } });
      await prisma.invoiceTaxLine.deleteMany({ where: { jurisdictionId: { in: [jurA, jurB] } } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.customerTaxExemption.deleteMany({ where: { customerId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId: { in: [jurA, jurB] } } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: { in: [jurA, jurB] } } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    }
  });

  it("bounds the back-dated credit at the certificate's expiration day", async () => {
    const tag = randomUUID().slice(0, 8);
    const ownerId = "tfa2-ex3-owner-" + tag;
    const userId = "tfa2-ex3-user-" + tag;
    const customerId = "tfa2-ex3-customer-" + tag;
    const jurisdictionId = "tfa2-ex3-jur-" + tag;
    try {
      await prisma.user.createMany({
        data: [
          { id: ownerId, email: tag + "-owner3@example.test", name: "Ex Owner", role: "OWNER", emailVerified: true },
          { id: userId, email: tag + "-customer3@example.test", name: "Bounded Customer", role: "CUSTOMER", emailVerified: true },
        ],
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: "X" + tag },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "E3-" + tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2025-01-01"), source: "MANUAL" },
      });
      async function taxedInvoice(issuedAt: Date, taxCents: number) {
        const invoice = await prisma.invoice.create({
          data: { customerId, status: "PAID", issuedAt, amountDueCents: 10000 + taxCents },
        });
        await prisma.invoiceTaxLine.create({
          data: {
            invoiceId: invoice.id, jurisdictionId, rateVersionId: rate.id,
            category: "RENTAL", taxableCents: 10000, taxCents, source: "ENGINE",
          },
        });
      }
      await taxedInvoice(daysAgo(50), 500); // inside the certificate's days: credited
      await taxedInvoice(daysAgo(10), 400); // after it expired: not credited

      await createCustomerTaxExemption(ownerId, customerId, {
        reason: "CHARITABLE", certificatePhotoId: "photo-" + tag,
        jurisdictionIds: [jurisdictionId], validFrom: daysAgo(60), expiresOn: daysAgo(40),
      });
      const credits = await prisma.customerCredit.findMany({ where: { customerId } });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amountCents).toBe(500);
    } finally {
      await prisma.customerCredit.deleteMany({ where: { customerId } });
      await prisma.invoiceTaxLine.deleteMany({ where: { jurisdictionId } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.customerTaxExemption.deleteMany({ where: { customerId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    }
  });

  it("never credits the same tax twice for overlapping certificates", async () => {
    const tag = randomUUID().slice(0, 8);
    const ownerId = "tfa2-ex4-owner-" + tag;
    const userId = "tfa2-ex4-user-" + tag;
    const customerId = "tfa2-ex4-customer-" + tag;
    const jurisdictionId = "tfa2-ex4-jur-" + tag;
    try {
      await prisma.user.createMany({
        data: [
          { id: ownerId, email: tag + "-owner4@example.test", name: "Ex Owner", role: "OWNER", emailVerified: true },
          { id: userId, email: tag + "-customer4@example.test", name: "Overlap Customer", role: "CUSTOMER", emailVerified: true },
        ],
      });
      await prisma.customer.create({
        data: { id: customerId, userId, referralCode: "O" + tag },
      });
      await prisma.taxJurisdiction.create({
        data: {
          id: jurisdictionId, code: "E4-" + tag, name: "Test state",
          level: "STATE", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
        },
      });
      const rate = await prisma.taxRateVersion.create({
        data: { jurisdictionId, rateMilliPercent: 5000, effectiveFrom: day("2025-01-01"), source: "MANUAL" },
      });
      const invoice = await prisma.invoice.create({
        data: { customerId, status: "PAID", issuedAt: daysAgo(20), amountDueCents: 10700 },
      });
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: invoice.id, jurisdictionId, rateVersionId: rate.id,
          category: "RENTAL", taxableCents: 10000, taxCents: 700, source: "ENGINE",
        },
      });

      await createCustomerTaxExemption(ownerId, customerId, {
        reason: "CHARITABLE", certificatePhotoId: "photo-a-" + tag,
        jurisdictionIds: [jurisdictionId], validFrom: daysAgo(30),
      });
      // A second certificate covering the same days and area finds the tax
      // already credited and adds nothing.
      await createCustomerTaxExemption(ownerId, customerId, {
        reason: "CHARITABLE", certificatePhotoId: "photo-b-" + tag,
        jurisdictionIds: [jurisdictionId], validFrom: daysAgo(25),
      });
      const credits = await prisma.customerCredit.findMany({ where: { customerId } });
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amountCents).toBe(700);
    } finally {
      await prisma.customerCredit.deleteMany({ where: { customerId } });
      await prisma.invoiceTaxLine.deleteMany({ where: { jurisdictionId } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.customerTaxExemption.deleteMany({ where: { customerId } });
      await prisma.taxRateVersion.deleteMany({ where: { jurisdictionId } });
      await prisma.taxJurisdiction.deleteMany({ where: { id: jurisdictionId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
    }
  });
});
