import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { buildRdfPacketInTx, reserveRdfCreditsInTx } from "@/domains/tax/rdf-filing";
import { loadFilingPacketInTx } from "@/domains/tax/filing-packet";
import { buildFilingAmendmentPacket } from "@/domains/tax/filing";

const uri = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
class Rollback extends Error {}
type Tx = Prisma.TransactionClient;

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
  const ownerId = "rdf4-owner-" + token;
  const customerId = "rdf4-customer-" + token;
  const agreementId = "rdf4-agreement-" + token;
  const addressId = "rdf4-address-" + token;
  const jobId = "rdf4-job-" + token;
  await tx.user.create({ data: {
    id: ownerId, email: token + "@rdf4.example.test", role: "OWNER",
    name: "RDF filing fixture", passwordHash: "test-only",
  } });
  await tx.customer.create({ data: {
    id: customerId, userId: ownerId, referralCode: "RDF4" + token.slice(0, 13),
  } });
  await tx.serviceAddress.create({ data: {
    id: addressId, customerId, line1: "1 Fixture Ln", city: "Greeley",
    state: "CO", zip: "80631",
  } });
  await tx.rentalAgreement.create({ data: {
    id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
  } });
  await tx.job.create({ data: {
    id: jobId, type: "DELIVERY", status: "COMPLETED",
    agreementId, customerId, serviceAddressId: addressId,
  } });
  const rate = await tx.retailDeliveryFeeRate.create({
    data: {
      effectiveOn: day("2026-07-01"),
      amountCents: 31, enteredByUserId: ownerId,
    },
  });
  const account = await tx.taxFilingAccount.create({ data: {
    kind: "RETAIL_DELIVERY_FEE_RETURN",
    name: "Colorado RDF fixture " + token,
    frequency: "MONTHLY", firstPeriodStart: day("2026-06-01"),
    basis: "UNDECIDED",
  } });
  async function period(start: string, end: string) {
    return tx.taxFilingPeriod.create({ data: {
      filingAccountId: account.id, periodStart: day(start), periodEnd: day(end),
      dueOn: day(end),
    } });
  }
  async function record(
    deliveredOn: string, saleOn: string,
    status: "READY" | "NOT_DUE" | "PENDING_RATE" = "READY",
    opts: { collected?: boolean; rateId?: string; cents?: number } = {},
  ) {
    const id = "rdf4-record-" + randomUUID().replaceAll("-", "");
    return tx.retailDeliveryFeeRecord.create({
      data: {
        id, agreementId, firstJobId: jobId,
        saleKey: "agreement:" + agreementId + ":" + id,
        deliveredOn: day(deliveredOn), saleOn: day(saleOn),
        status, ...(status === "READY" ? {
          rateId: opts.rateId ?? rate.id,
          amountCents: opts.cents ?? 31,
          collectedFromCustomer: opts.collected ?? false,
        } : {}),
      },
    });
  }
  async function frozenOriginal(recordId: string, sourcePeriodId: string) {
    const packet = await loadFilingPacketInTx(tx, sourcePeriodId);
    expect(packet.status).toBe("READY");
    if (packet.status !== "READY") throw Error("RDF prior packet unexpectedly blocked");
    await tx.taxFilingPeriod.update({
      where: { id: sourcePeriodId },
      data: { status: "FILED", worksheet: JSON.parse(JSON.stringify(packet.packet)) },
    });
    await tx.retailDeliveryFeeRecord.update({
      where: { id: recordId }, data: { filingPeriodId: sourcePeriodId },
    });
  }
  return { tx, rate, account, ownerId, customerId, agreementId, record, period, frozenOriginal };
}

describe.skipIf(!enabled)("T-6C4 RDF filing with isolated PostgreSQL", () => {
  it("uses delivery month, but the sale-date's previously chosen rate", async () => {
    await withEvidence(async f => {
      const juneRate = await f.tx.retailDeliveryFeeRate.create({
        data: { effectiveOn: day("2026-01-01"), amountCents: 30, enteredByUserId: f.ownerId },
      });
      const period = await f.period("2026-07-01", "2026-07-31");
      const fee = await f.record("2026-07-02", "2026-06-30", "READY", {
        rateId: juneRate.id, cents: 30,
      });
      const packet = await buildRdfPacketInTx(f.tx, period.id);
      expect(packet).toMatchObject({
        periodId: period.id, deliveries: 1, taxDueCents: 30,
        priorPeriodCreditCents: 0,
      });
      expect(packet.rows).toEqual([{
        rateId: juneRate.id, amountCents: 30, count: 1, totalCents: 30,
      }]);
      expect(packet.sourceRecordIds).toEqual([fee.id]);
    });
  });

  it("read-only preview never reserves an available prior-period credit", async () => {
    await withEvidence(async f => {
      const old = await f.period("2026-08-01", "2026-08-31");
      const next = await f.period("2026-09-01", "2026-09-30");
      const fee = await f.record("2026-08-03", "2026-08-01");
      await f.frozenOriginal(fee.id, old.id);
      await f.tx.retailDeliveryFeeRecord.update({
        where: { id: fee.id }, data: {
          status: "NOT_DUE", rateId: null, amountCents: null, collectedFromCustomer: null,
        },
      });
      await f.record("2026-09-03", "2026-09-01");
      const a = await buildRdfPacketInTx(f.tx, next.id);
      const b = await buildRdfPacketInTx(f.tx, next.id);
      expect(a.creditRecordIds).toEqual([fee.id]);
      expect(b.priorPeriodCreditCents).toBe(31);
      expect((await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
        where: { id: fee.id },
      })).creditAppliedPeriodId).toBeNull();
    });
  });

  it("two filed returns can never reuse the same credit", async () => {
    await withEvidence(async f => {
      const old = await f.period("2026-08-01", "2026-08-31");
      const next = await f.period("2026-09-01", "2026-09-30");
      const later = await f.period("2026-10-01", "2026-10-31");
      const fee = await f.record("2026-08-03", "2026-08-01");
      await f.frozenOriginal(fee.id, old.id);
      await f.tx.retailDeliveryFeeRecord.update({
        where: { id: fee.id }, data: { status: "NOT_DUE" },
      });
      await f.record("2026-09-03", "2026-09-01");
      await f.record("2026-10-03", "2026-10-01");
      await reserveRdfCreditsInTx(f.tx, next.id, [fee.id]);
      expect(await buildRdfPacketInTx(f.tx, later.id)).toMatchObject({
        creditRecordIds: [], priorPeriodCreditCents: 0,
      });
      await expect(reserveRdfCreditsInTx(f.tx, later.id, [fee.id])).rejects.toThrow();
      expect((await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
        where: { id: fee.id },
      })).creditAppliedPeriodId).toBe(next.id);
    });
  });

  it("customer collection must be fully refunded before its credit is offered", async () => {
    await withEvidence(async f => {
      const old = await f.period("2026-08-01", "2026-08-31");
      const next = await f.period("2026-09-01", "2026-09-30");
      const fee = await f.record("2026-08-03", "2026-08-01", "READY", {
        collected: true,
      });
      await f.frozenOriginal(fee.id, old.id);
      await f.tx.retailDeliveryFeeRecord.update({
        where: { id: fee.id }, data: {
          status: "NOT_DUE", rateId: null, amountCents: null, collectedFromCustomer: null,
        },
      });
      await f.record("2026-09-03", "2026-09-01");
      expect((await buildRdfPacketInTx(f.tx, next.id)).creditRecordIds).toEqual([]);

      const invoice = await f.tx.invoice.create({ data: {
        agreementId: f.agreementId, customerId: f.customerId,
        status: "OPEN", amountDueCents: 31,
        lineItems: { create: {
          kind: "RETAIL_DELIVERY_FEE", amountCents: 31, description: "Colorado retail delivery fee",
        } },
      }, include: { lineItems: true } });
      const refund = await f.tx.refund.create({ data: {
        invoiceId: invoice.id, amountCents: 31, reason: "OTHER",
      } });
      await f.tx.retailDeliveryFeeRecord.update({ where: { id: fee.id }, data: {
        invoiceLineId: invoice.lineItems[0]!.id,
        customerRefundRef: refund.id,
        customerRefundedAt: new Date(refund.createdAt.getTime() + 1000),
      } });
      expect((await buildRdfPacketInTx(f.tx, next.id)).creditRecordIds).toEqual([fee.id]);
    });
  });

  it("an added fee increases the original return and opens a positive amendment", async () => {
    await withEvidence(async f => {
      const period = await f.period("2026-08-01", "2026-08-31");
      await f.record("2026-08-03", "2026-08-01");
      const previous = await loadFilingPacketInTx(f.tx, period.id);
      expect(previous.status).toBe("READY");
      if (previous.status !== "READY") return;
      await f.record("2026-08-04", "2026-08-01");
      const corrected = await loadFilingPacketInTx(f.tx, period.id);
      expect(corrected.status).toBe("READY");
      if (corrected.status !== "READY") return;
      const amendment = buildFilingAmendmentPacket(previous.packet, corrected.packet);
      expect(amendment.additionalTaxCents).toBe(31);
      expect(amendment.differences.some(row => row.differenceCents > 0)).toBe(true);
    });
  });

  it("zero return stays available and any undecided delivery blocks it", async () => {
    await withEvidence(async f => {
      const period = await f.period("2026-08-01", "2026-08-31");
      const zero = await buildRdfPacketInTx(f.tx, period.id);
      expect(zero).toMatchObject({
        deliveries: 0, rows: [], taxDueCents: 0, blockers: [],
      });
      const pending = await f.record("2026-08-03", "2026-08-01", "PENDING_RATE");
      const packet = await buildRdfPacketInTx(f.tx, period.id);
      expect(packet.blockers.join(" ")).toContain(pending.id);
      expect((await loadFilingPacketInTx(f.tx, period.id)).status).toBe("BLOCKED");
    });
  });
});

