import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { ruleAsOf, nextRuleChange, getRuleTimingSettings } from "@/domains/rules/reads";
import { saveRuleVersion, undoRuleVersion, saveRuleTimingSettings } from "@/domains/rules/changes";
import { trueUpLateChange } from "@/domains/rules/true-up";

const uri = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  uri !== null &&
  ["localhost", "127.0.0.1"].includes(uri.hostname) &&
  uri.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;

/** Seeded rule version ids from the TFA-1 migration. */
const RDF_JUL_2026 = "rule-co-rdf-amount-20260701";

type Fixture = {
  ownerId: string;
  customerId: string;
  invoiceId: string;
  lineId: string;
  nextBillId: string;
  recordId: string;
  token: string;
};

async function fixture(): Promise<Fixture> {
  const token = randomUUID().replaceAll("-", "");
  const ownerId = "rules-owner-" + token;
  const customerId = "rules-customer-" + token;
  await prisma.user.create({
    data: { id: ownerId, email: token + "@rules.test", role: "OWNER", name: "Rules fixture", passwordHash: "test-only" },
  });
  await prisma.customer.create({ data: { id: customerId, userId: ownerId, referralCode: "RULES" + token.slice(0, 13) } });
  const invoice = await prisma.invoice.create({
    data: {
      customerId, status: "OPEN", subtotalCents: 31, amountDueCents: 31, amountPaidCents: 0,
      issuedAt: new Date("2026-07-02T12:00:00Z"),
    },
  });
  const line = await prisma.invoiceLineItem.create({
    data: { invoiceId: invoice.id, kind: "RETAIL_DELIVERY_FEE", description: "Colorado retail delivery fee", amountCents: 31 },
  });
  const nextBill = await prisma.invoice.create({
    data: { customerId, status: "OPEN", subtotalCents: 5000, amountDueCents: 5000, amountPaidCents: 0 },
  });
  const record = await prisma.retailDeliveryFeeRecord.create({
    data: {
      saleKey: "rules-sale-" + token,
      deliveredOn: day("2026-07-02"), saleOn: day("2026-07-02"),
      status: "READY", ruleVersionId: RDF_JUL_2026, amountCents: 31,
      collectedFromCustomer: true, invoiceLineId: line.id,
    },
  });
  return { ownerId, customerId, invoiceId: invoice.id, lineId: line.id, nextBillId: nextBill.id, recordId: record.id, token };
}

async function cleanup(f: Fixture, changeIds: string[] = []): Promise<void> {
  await prisma.creditApplication.deleteMany({ where: { invoiceId: { in: [f.invoiceId, f.nextBillId] } } });
  await prisma.customerCredit.deleteMany({ where: { customerId: f.customerId } });
  const journals = await prisma.journalEntry.findMany({
    where: { sourceId: { in: changeIds }, eventKind: { startsWith: "RULE_TRUE_UP_ABSORBED:" } },
    select: { id: true },
  });
  if (journals.length) {
    await prisma.journalLine.deleteMany({ where: { entryId: { in: journals.map((j) => j.id) } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journals.map((j) => j.id) } } });
  }
  await prisma.staffTask.deleteMany({ where: { createdByUserId: f.ownerId } });
  await prisma.auditLog.deleteMany({ where: { userId: f.ownerId } });
  await prisma.retailDeliveryFeeRecord.deleteMany({ where: { id: f.recordId } });
  await prisma.invoiceLineItem.deleteMany({ where: { id: f.lineId } });
  await prisma.invoice.deleteMany({ where: { id: { in: [f.invoiceId, f.nextBillId] } } });
  await prisma.legalRuleVersion.deleteMany({ where: { createdByUserId: f.ownerId } });
  await prisma.customer.deleteMany({ where: { id: f.customerId } });
  await prisma.user.deleteMany({ where: { id: f.ownerId } });
}

describe.skipIf(!enabled)("TFA-1 dated rules (isolated PostgreSQL)", () => {
  it("reads the seeded RDF amount by sale date: Jun 30 vs Jul 1", async () => {
    expect((await ruleAsOf<number>("co.rdf.amount", day("2026-06-30"))).value).toBe(28);
    expect((await ruleAsOf<number>("co.rdf.amount", day("2026-07-01"))).value).toBe(31);
    expect((await ruleAsOf<number>("co.sales.state_service_fee", day("2026-01-01"))).value).toBe(0);
    expect((await ruleAsOf<number>("us.1099.threshold", day("2026-01-01"))).value).toBe(200000);
    expect((await ruleAsOf<number>("records.keep_years", day("2026-01-01"))).value).toBe(7);
    expect((await nextRuleChange("co.rdf.amount", day("2026-06-30")))?.value).toBe(31);
  });

  it("an owner version wins over researched at the same start date", async () => {
    const f = await fixture();
    let changeId = "";
    try {
      const { versionId } = await saveRuleVersion(f.ownerId, {
        key: "co.rdf.amount", value: 99, effectiveFrom: day("2026-07-01"),
        reason: "Test-only owner value.",
      });
      changeId = versionId;
      expect((await ruleAsOf<number>("co.rdf.amount", day("2026-07-01"))).value).toBe(99);
      expect((await ruleAsOf<number>("co.rdf.amount", day("2026-06-30"))).value).toBe(28);
      expect(versionId).toBeTruthy();
    } finally {
      await cleanup(f, changeId ? [changeId] : []);
    }
  });

  it("undo of a future owner change restores the researched value; a started change cannot be undone", async () => {
    const f = await fixture();
    const changeIds: string[] = [];
    try {
      const { versionId } = await saveRuleVersion(f.ownerId, {
        key: "co.rdf.amount", value: 40, effectiveFrom: day("2027-07-01"),
        reason: "Test-only future value.",
      });
      changeIds.push(versionId);
      expect((await ruleAsOf<number>("co.rdf.amount", day("2027-07-01"))).value).toBe(40);
      await undoRuleVersion(f.ownerId, versionId);
      expect((await ruleAsOf<number>("co.rdf.amount", day("2027-07-01"))).value).toBe(31);
      const started = await saveRuleVersion(f.ownerId, {
        key: "co.rdf.amount", value: 41, effectiveFrom: day("2026-07-01"),
        reason: "Test-only started value.",
      });
      changeIds.push(started.versionId);
      await expect(undoRuleVersion(f.ownerId, started.versionId)).rejects.toThrow(/already started/i);
    } finally {
      await cleanup(f, changeIds);
    }
  });

  it("a late increase is absorbed by the business, never billed to the customer", async () => {
    const f = await fixture();
    let changeId = "";
    try {
      const saved = await saveRuleVersion(f.ownerId, {
        key: "co.rdf.amount", value: 35, effectiveFrom: day("2026-07-01"),
        reason: "Test-only late increase.",
      });
      changeId = saved.versionId;
      expect(saved.trueUp.recordsChanged).toBe(1);
      expect(saved.trueUp.absorbedCents).toBe(4);
      // The issued bill line never changes; only the filing record is corrected.
      expect((await prisma.invoiceLineItem.findUniqueOrThrow({ where: { id: f.lineId } })).amountCents).toBe(31);
      expect((await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: f.recordId } })).amountCents).toBe(35);
      const journal = await prisma.journalEntry.findFirst({
        where: { sourceId: changeId, eventKind: "RULE_TRUE_UP_ABSORBED:" + f.recordId },
        include: { lines: { include: { ledgerAccount: { select: { systemRole: true } } } } },
      });
      expect(journal).not.toBeNull();
      expect(journal!.lines.map((line) => [line.ledgerAccount.systemRole, line.debitCents, line.creditCents]))
        .toEqual(expect.arrayContaining([
          ["TAX_ABSORBED", 4, 0],
          ["RETAIL_DELIVERY_FEE_PAYABLE", 0, 4],
        ]));
      expect(await prisma.staffTask.count({
        where: { createdByUserId: f.ownerId, sourceKey: `rule-true-up-absorbed:${changeId}:${f.recordId}` },
      })).toBe(1);
      // Running the same true-up again changes nothing.
      const again = await prisma.$transaction((tx) => trueUpLateChange(tx, f.ownerId, {
        id: changeId, ruleKey: "co.rdf.amount", effectiveFrom: day("2026-07-01"), label: "Colorado retail delivery fee",
      }, new Date()));
      expect(again.recordsChanged).toBe(0);
    } finally {
      await cleanup(f, changeId ? [changeId] : []);
    }
  });

  it("a late decrease credits the customer's next bill with the rule's words", async () => {
    const f = await fixture();
    let changeId = "";
    try {
      const saved = await saveRuleVersion(f.ownerId, {
        key: "co.rdf.amount", value: 28, effectiveFrom: day("2026-07-01"),
        reason: "Test-only late decrease.",
      });
      changeId = saved.versionId;
      expect(saved.trueUp.recordsChanged).toBe(1);
      expect(saved.trueUp.creditedCents).toBe(3);
      expect((await prisma.invoiceLineItem.findUniqueOrThrow({ where: { id: f.lineId } })).amountCents).toBe(31);
      expect((await prisma.retailDeliveryFeeRecord.findUniqueOrThrow({ where: { id: f.recordId } })).amountCents).toBe(28);
      const credit = await prisma.customerCredit.findFirstOrThrow({
        where: { customerId: f.customerId, sourceType: "RULE_TRUE_UP" },
      });
      expect(credit.amountCents).toBe(3);
      expect(credit.reason).toContain("Credit: delivery fee went down on Jul 1");
      const application = await prisma.creditApplication.findFirstOrThrow({
        where: { creditId: credit.id, invoiceId: f.nextBillId },
      });
      expect(application.amountCents).toBe(3);
      const nextBillLine = await prisma.invoiceLineItem.findFirst({
        where: { invoiceId: f.nextBillId, kind: "CREDIT" },
      });
      expect(nextBillLine?.description).toContain("Credit: delivery fee went down on Jul 1");
    } finally {
      await cleanup(f, changeId ? [changeId] : []);
    }
  });

  it("timing settings save with compare-and-set and restore", async () => {
    const f = await fixture();
    const before = await getRuleTimingSettings();
    try {
      await saveRuleTimingSettings(f.ownerId, {
        percent: 92, marginBusinessDays: 2,
        expectedPercent: before.percent, expectedMarginBusinessDays: before.marginBusinessDays,
      });
      expect(await getRuleTimingSettings()).toEqual({ percent: 92, marginBusinessDays: 2 });
      await expect(saveRuleTimingSettings(f.ownerId, {
        percent: 90, marginBusinessDays: 3,
        expectedPercent: before.percent, expectedMarginBusinessDays: before.marginBusinessDays,
      })).rejects.toThrow(/another session/i);
    } finally {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { costlyChangeTimingPercent: before.percent, timingSafetyMarginBusinessDays: before.marginBusinessDays },
      });
      await cleanup(f);
    }
  });
});
