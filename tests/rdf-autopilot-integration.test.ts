import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { findRdfThresholdCrossing, recordedRetailSales } from "@/domains/tax/rdf-sales-evidence";
import { recordCrossingIfCrossed } from "@/domains/tax/rdf-threshold-evidence";
import {
  approveRdfSwitch,
  prepareRdfSwitches,
  rdfFeeAbsorbedByLateApproval,
} from "@/domains/tax/rdf-switches";
import { prepareRdfChargeInTx } from "@/domains/tax/rdf-charges";

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
      // The same nightly pass also dated the START from the 2029 crossing.
      await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn: day("2029-10-01") } });
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
      // The same pass can date a START from the June 2030 crossing.
      await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn: day("2030-10-01") } });
      await cleanup(ids);
    }
  });
});

describe.skipIf(!enabled)("TFA-2 §6.3/§4a: deliveries before approval are absorbed, never charged later (real Postgres)", () => {
  it("absorbs a held rental record at charge time and keeps it absorbed after approval", async () => {
    const token = randomUUID().replaceAll("-", "");
    const ownerId = "tfa2a-owner-" + token;
    const customerId = "tfa2a-customer-" + token;
    const addressId = "tfa2a-address-" + token;
    const agreementId = "tfa2a-agreement-" + token;
    const jobId = "tfa2a-job-" + token;
    const savedFlag = process.env.RDF_CUSTOMER_CHARGING_ENABLED;
    process.env.RDF_CUSTOMER_CHARGING_ENABLED = "true";
    let switchId = "";
    let recordId = "";
    let ruleId = "";
    try {
      await prisma.user.create({ data: {
        id: ownerId, email: token + "@tfa2a.example.test", role: "OWNER",
        name: "TFA-2 absorption fixture", passwordHash: "test-only", emailVerified: true,
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
      await prisma.job.create({ data: {
        id: jobId, type: "DELIVERY", status: "COMPLETED",
        agreementId, customerId, serviceAddressId: addressId,
        completedAt: day("2033-03-10"),
      } });
      const rule = await prisma.legalRuleVersion.create({ data: {
        ruleKey: "co.rdf.amount", value: 29, effectiveFrom: day("2033-01-01"),
        origin: "OWNER", provisional: false, createdByUserId: ownerId,
      } });
      ruleId = rule.id;
      const sw = await prisma.retailDeliveryFeeSwitch.create({
        data: { kind: "START", startsOn: day("2033-03-01"), basisRetailCents: null },
      });
      switchId = sw.id;
      // A delivery made while the switch awaited approval, recorded as
      // collectible (as records created before the switch existed are).
      const record = await prisma.retailDeliveryFeeRecord.create({
        data: {
          saleKey: "agreement:" + agreementId, agreementId, firstJobId: jobId,
          deliveredOn: day("2033-03-10"), saleOn: day("2033-03-10"), status: "READY",
          amountCents: 29, collectedFromCustomer: true, ruleVersionId: rule.id,
        },
      });
      recordId = record.id;

      // Before approval: the charge pass absorbs the record instead of
      // billing it, and writes the disposition down.
      const first = await prisma.$transaction((tx) => prepareRdfChargeInTx(tx, recordId));
      expect(first.kind).toBe("NONE");
      const absorbed = await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: recordId } });
      expect(absorbed.collectedFromCustomer).toBe(false);
      expect(absorbed.invoiceLineId).toBeNull();
      expect(await prisma.auditLog.count({
        where: { action: "tax.rdf.charge_absorbed", entityId: recordId },
      })).toBe(1);

      // Approval does not revive it: no later pass can charge that delivery.
      await approveRdfSwitch(ownerId, switchId);
      const second = await prisma.$transaction((tx) => prepareRdfChargeInTx(tx, recordId));
      expect(second.kind).toBe("NONE");
      const after = await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: recordId } });
      expect(after.collectedFromCustomer).toBe(false);
      expect(after.invoiceLineId).toBeNull();
    } finally {
      if (savedFlag === undefined) delete process.env.RDF_CUSTOMER_CHARGING_ENABLED;
      else process.env.RDF_CUSTOMER_CHARGING_ENABLED = savedFlag;
      await prisma.auditLog.deleteMany({ where: { entityId: recordId } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.retailDeliveryFeeRecord.deleteMany({ where: { agreementId } });
      if (switchId) await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { id: switchId } });
      if (ruleId) await prisma.legalRuleVersion.deleteMany({ where: { id: ruleId } });
      await prisma.job.deleteMany({ where: { id: jobId } });
      await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
      await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    }
  });

  it("the absorption test itself: approval timing decides", async () => {
    const startsOn = day("2033-03-01");
    await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn } });
    try {
      // No governing switch for a date before every fixture switch:
      // nothing is absorbed. (Other tests in this file prepare switches
      // from 2029 on; this predicate reads the whole table by design.)
      await prisma.$transaction(async (tx) => {
        expect(await rdfFeeAbsorbedByLateApproval(tx, day("2020-01-10"))).toBe(false);
      });
      // Approved before the delivery day: the fee is charged normally.
      const early = await prisma.retailDeliveryFeeSwitch.create({
        data: { kind: "START", startsOn, approvedAt: day("2033-02-15"), approvedByUserId: null },
      });
      await prisma.$transaction(async (tx) => {
        expect(await rdfFeeAbsorbedByLateApproval(tx, day("2033-03-10"))).toBe(false);
      });
      await prisma.retailDeliveryFeeSwitch.delete({ where: { id: early.id } });
      // Approved after the delivery day: the business carries that fee.
      const late = await prisma.retailDeliveryFeeSwitch.create({
        data: { kind: "START", startsOn, approvedAt: day("2033-03-20"), approvedByUserId: null },
      });
      await prisma.$transaction(async (tx) => {
        expect(await rdfFeeAbsorbedByLateApproval(tx, day("2033-03-10"))).toBe(true);
        // A delivery after the approval day is not absorbed.
        expect(await rdfFeeAbsorbedByLateApproval(tx, day("2033-03-25"))).toBe(false);
      });
      await prisma.retailDeliveryFeeSwitch.delete({ where: { id: late.id } });
    } finally {
      await prisma.retailDeliveryFeeSwitch.deleteMany({ where: { startsOn } });
    }
  });
});
