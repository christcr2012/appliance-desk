import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { findRdfThresholdCrossing, recordedRetailSales } from "@/domains/tax/rdf-sales-evidence";
import { recordCrossingIfCrossed } from "@/domains/tax/rdf-threshold-evidence";
import { prepareRdfSwitches } from "@/domains/tax/rdf-switches";

const uri = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
class Rollback extends Error {}
type Tx = Prisma.TransactionClient;

// A far-future year no seed or other fixture uses, so the year's totals are
// exactly this fixture's.
const YEAR = 2031;

async function withEvidence(run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  try {
    await prisma.$transaction(async tx => {
      const f = await fixture(tx);
      await run(f);
      throw new Rollback();
    }, { timeout: 30000 });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function fixture(tx: Tx) {
  const token = randomUUID().replaceAll("-", "");
  const ownerId = "tfa2-owner-" + token;
  const customerId = "tfa2-customer-" + token;
  const addressId = "tfa2-address-" + token;
  await tx.user.create({ data: {
    id: ownerId, email: token + "@tfa2.example.test", role: "OWNER",
    name: "TFA-2 fixture", passwordHash: "test-only",
  } });
  await tx.customer.create({ data: {
    id: customerId, userId: ownerId, referralCode: "TFA2" + token.slice(0, 13),
  } });
  await tx.serviceAddress.create({ data: {
    id: addressId, customerId, line1: "1 Fixture Ln", city: "Greeley",
    state: "CO", zip: "80631",
  } });
  let seq = 0;
  async function agreement() {
    const id = "tfa2-agreement-" + token + "-" + (seq++);
    await tx.rentalAgreement.create({ data: {
      id, customerId, serviceAddressId: addressId, status: "ACTIVE",
    } });
    return id;
  }
  async function rentInvoice(agreementId: string, issuedAt: Date, cents: number) {
    return tx.invoice.create({ data: {
      customerId, agreementId, status: "OPEN", issuedAt,
      amountDueCents: cents,
      lineItems: { create: { kind: "RENTAL", description: "TFA-2 rent", amountCents: cents } },
    }, select: { id: true } });
  }
  async function cancelBeforeDelivery(agreementId: string, refundCents: number) {
    await tx.preDeliveryCancellation.create({ data: {
      agreementId, policy: "FULL_REFUND", signedAmountCents: refundCents,
      refundDueCents: refundCents, retainedCents: 0,
      reason: "Customer changed plans before delivery.",
      reviewedTerms: true, approvedByUserId: ownerId,
      refundState: "RETURNED_MANUAL_RECORDED", returnedOn: new Date(),
    } });
  }
  return { tx, ownerId, customerId, agreement, rentInvoice, cancelBeforeDelivery };
}

describe.skipIf(!enabled)("TFA-2 RDF autopilot: crossing walk and sales evidence (real Postgres)", () => {
  it("dates the crossing from the invoice that first passes the threshold", async () => {
    await withEvidence(async f => {
      const a = await f.agreement();
      const b = await f.agreement();
      const c = await f.agreement();
      await f.rentInvoice(a, new Date("2031-01-10T12:00:00Z"), 30000);
      const crossing = await f.rentInvoice(b, new Date("2031-02-10T12:00:00Z"), 30000);
      await f.rentInvoice(c, new Date("2031-03-10T12:00:00Z"), 30000);
      const found = await findRdfThresholdCrossing(f.tx, YEAR, 50000);
      expect(found?.invoiceId).toBe(crossing.id);
      expect(businessDateKey(found!.crossedOn)).toBe("2031-02-10");
      // Reaching the threshold exactly is not passing it.
      const later = await findRdfThresholdCrossing(f.tx, YEAR, 60000);
      expect(later?.invoiceId).not.toBe(crossing.id);
      expect(await findRdfThresholdCrossing(f.tx, YEAR, 90000)).toBeNull();
    });
  });

  it("uses the Denver date of the crossing invoice, not its UTC date", async () => {
    await withEvidence(async f => {
      const a = await f.agreement();
      // July 2 02:00 UTC is July 1 in Denver.
      await f.rentInvoice(a, new Date("2031-07-02T02:00:00Z"), 60000);
      const found = await findRdfThresholdCrossing(f.tx, YEAR, 50000);
      expect(businessDateKey(found!.crossedOn)).toBe("2031-07-01");
    });
  });

  it("takes a sale cancelled before delivery (and refunded) out of the total and the walk", async () => {
    await withEvidence(async f => {
      const a = await f.agreement();
      const b = await f.agreement();
      const c = await f.agreement();
      await f.rentInvoice(a, new Date("2031-01-10T12:00:00Z"), 30000);
      await f.rentInvoice(b, new Date("2031-02-10T12:00:00Z"), 30000);
      const last = await f.rentInvoice(c, new Date("2031-03-10T12:00:00Z"), 30000);
      await f.cancelBeforeDelivery(b, 30000);
      expect(await recordedRetailSales(f.tx, YEAR)).toBe(60000);
      const found = await findRdfThresholdCrossing(f.tx, YEAR, 50000);
      expect(found?.invoiceId).toBe(last.id);
      expect(businessDateKey(found!.crossedOn)).toBe("2031-03-10");
    });
  });

  it("an approved cancellation whose refund has not been returned yet still counts", async () => {
    await withEvidence(async f => {
      const a = await f.agreement();
      await f.rentInvoice(a, new Date("2031-01-10T12:00:00Z"), 30000);
      await f.tx.preDeliveryCancellation.create({ data: {
        agreementId: a, policy: "FULL_REFUND", signedAmountCents: 30000,
        refundDueCents: 30000, retainedCents: 0,
        reason: "Customer changed plans before delivery.",
        reviewedTerms: true, approvedByUserId: f.ownerId,
        refundState: "PENDING_EXTERNAL_REFUND",
      } });
      expect(await recordedRetailSales(f.tx, YEAR)).toBe(30000);
    });
  });
});

describe.skipIf(!enabled)("TFA-2 RDF autopilot: nightly crossing recording (real Postgres)", () => {
  it("records the crossing once, from the crossing invoice, and never moves it", async () => {
    const old = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { rdfThresholdCrossedOn: true },
    });
    const token = randomUUID().replaceAll("-", "");
    const ownerId = "tfa2n-owner-" + token;
    const customerId = "tfa2n-customer-" + token;
    const addressId = "tfa2n-address-" + token;
    const agreementId = "tfa2n-agreement-" + token;
    try {
      await prisma.businessSettings.upsert({
        where: { id: "singleton" },
        create: { rdfThresholdCrossedOn: null },
        update: { rdfThresholdCrossedOn: null },
      });
      await prisma.user.create({ data: {
        id: ownerId, email: token + "@tfa2n.example.test", role: "OWNER",
        name: "TFA-2 nightly fixture", passwordHash: "test-only",
      } });
      await prisma.customer.create({ data: {
        id: customerId, userId: ownerId, referralCode: "TFA2" + token.slice(0, 13),
      } });
      await prisma.serviceAddress.create({ data: {
        id: addressId, customerId, line1: "1 Fixture Ln", city: "Greeley",
        state: "CO", zip: "80631",
      } });
      await prisma.rentalAgreement.create({ data: {
        id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
      } });
      // One invoice over the $500,000 rule, issued March 5 of the test year.
      await prisma.invoice.create({ data: {
        customerId, agreementId, status: "OPEN",
        issuedAt: new Date("2031-03-05T12:00:00Z"), amountDueCents: 50000001,
        lineItems: { create: { kind: "RENTAL", description: "TFA-2 rent", amountCents: 50000001 } },
      } });
      const first = await recordCrossingIfCrossed(day("2031-06-01"));
      expect(businessDateKey(first!)).toBe("2031-03-05");
      const again = await recordCrossingIfCrossed(day("2031-06-02"));
      expect(businessDateKey(again!)).toBe("2031-03-05");
      const stored = await prisma.businessSettings.findUniqueOrThrow({
        where: { id: "singleton" }, select: { rdfThresholdCrossedOn: true },
      });
      expect(businessDateKey(stored.rdfThresholdCrossedOn!)).toBe("2031-03-05");
    } finally {
      await prisma.invoice.deleteMany({ where: { agreementId } });
      await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
      await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      if (old) await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { rdfThresholdCrossedOn: old.rdfThresholdCrossedOn },
      });
      await prisma.auditLog.deleteMany({
        where: {
          action: "tax.rdf.threshold_crossed", entityId: "singleton",
          newValue: { path: ["date"], equals: "2031-03-05" },
        },
      });
    }
  });
});

describe.skipIf(!enabled)("TFA-2 RDF autopilot: prepared switches (real Postgres)", () => {
  // Global-prisma fixtures (prepareRdfSwitches runs its own transaction),
  // always cleaned up; the settings row is saved and restored.
  async function salesFixture() {
    const token = randomUUID().replaceAll("-", "");
    const ids = {
      ownerId: "tfa2s-owner-" + token, customerId: "tfa2s-customer-" + token,
      addressId: "tfa2s-address-" + token, agreementId: "tfa2s-agreement-" + token,
    };
    await prisma.user.create({ data: {
      id: ids.ownerId, email: token + "@tfa2s.example.test", role: "OWNER",
      name: "TFA-2 switch fixture", passwordHash: "test-only",
    } });
    await prisma.customer.create({ data: {
      id: ids.customerId, userId: ids.ownerId, referralCode: "TFA2" + token.slice(0, 13),
    } });
    await prisma.serviceAddress.create({ data: {
      id: ids.addressId, customerId: ids.customerId, line1: "1 Fixture Ln", city: "Greeley",
      state: "CO", zip: "80631",
    } });
    await prisma.rentalAgreement.create({ data: {
      id: ids.agreementId, customerId: ids.customerId, serviceAddressId: ids.addressId, status: "ACTIVE",
    } });
    return ids;
  }
  async function rent(ids: { customerId: string; agreementId: string }, issuedAt: string, cents: number) {
    await prisma.invoice.create({ data: {
      customerId: ids.customerId, agreementId: ids.agreementId, status: "OPEN",
      issuedAt: new Date(issuedAt), amountDueCents: cents,
      lineItems: { create: { kind: "RENTAL", description: "TFA-2 rent", amountCents: cents } },
    } });
  }
  async function cleanup(ids: { ownerId: string; customerId: string; addressId: string; agreementId: string }) {
    await prisma.invoice.deleteMany({ where: { agreementId: ids.agreementId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: ids.agreementId } });
    await prisma.serviceAddress.deleteMany({ where: { id: ids.addressId } });
    await prisma.customer.deleteMany({ where: { id: ids.customerId } });
    await prisma.user.deleteMany({ where: { id: ids.ownerId } });
  }
  async function withCrossedOn<T>(crossedOn: Date | null, run: () => Promise<T>): Promise<T> {
    const old = await prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { rdfThresholdCrossedOn: true },
    });
    await prisma.businessSettings.update({
      where: { id: "singleton" }, data: { rdfThresholdCrossedOn: crossedOn },
    });
    try {
      return await run();
    } finally {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { rdfThresholdCrossedOn: old?.rdfThresholdCrossedOn ?? null },
      });
    }
  }
  const switchesAt = (startsOn: Date) =>
    prisma.retailDeliveryFeeSwitch.findMany({ where: { startsOn } });

  it("prepares the new-business START switch from the crossing, once", async () => {
    await withCrossedOn(day("2031-01-15"), async () => {
      try {
        await prepareRdfSwitches(day("2031-01-20"));
        await prepareRdfSwitches(day("2031-01-21"));
        const rows = await switchesAt(day("2031-05-01"));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: "START", basisRetailCents: null, approvedAt: null });
      } finally {
        await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn: day("2031-05-01") } });
      }
    });
  });

  it("prepares a January 1 STOP switch in December after a year at or under the limit", async () => {
    const ids = await salesFixture();
    try {
      await rent(ids, "2029-06-01T12:00:00Z", 50000001);
      await rent(ids, "2030-06-01T12:00:00Z", 10000);
      await withCrossedOn(null, async () => {
        await prepareRdfSwitches(day("2030-12-15"));
      });
      const rows = await switchesAt(day("2031-01-01"));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "STOP", basisRetailCents: 10000, approvedAt: null });
    } finally {
      await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn: day("2031-01-01") } });
      await cleanup(ids);
    }
  });

  it("January removes a December STOP switch the final total no longer supports", async () => {
    const ids = await salesFixture();
    try {
      await rent(ids, "2030-06-01T12:00:00Z", 50000001);
      await prisma.retailDeliveryFeeSwitch.create({
        data: { kind: "STOP", startsOn: day("2031-01-01"), basisRetailCents: 40000000 },
      });
      // The June invoice crossed the limit, so the nightly job recorded the
      // crossing then; by December the fee had already started (Oct 1).
      await withCrossedOn(day("2030-06-01"), async () => {
        await prepareRdfSwitches(day("2031-01-10"));
      });
      // The year ended over the limit, so the fee stays on: no switch at all.
      expect(await switchesAt(day("2031-01-01"))).toHaveLength(0);
    } finally {
      await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn: day("2031-01-01") } });
      await cleanup(ids);
    }
  });
});
