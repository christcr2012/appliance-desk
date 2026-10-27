import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import {
  build1099Outputs,
  compute1099Year,
  payerIdentity,
  preparedDataFor1099,
  setCategory1099Box,
} from "@/domains/compliance/information-returns";
import { saveBusinessFacts } from "@/domains/compliance/profile";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const day = (s: string) => businessDateFromKey(s)!;

describe.skipIf(!enabled)("1099 preparation", () => {
  const tag = randomUUID().slice(0, 8);
  const necSupplier = `cmp3-nec-${tag}`;
  const rentSupplier = `cmp3-rent-${tag}`;
  const smallSupplier = `cmp3-small-${tag}`;
  const necCategory = `cmp3-cat-nec-${tag}`;
  const rentCategory = `cmp3-cat-rent-${tag}`;
  const mysteryCategory = `cmp3-cat-mystery-${tag}`;
  const expenseAccount = `cmp3-acct-${tag}`;
  const expenseIds: string[] = [];
  const entryIds: string[] = [];
  let ownerId: string;
  let bank: string;

  async function paidExpense(args: {
    id: string;
    supplierId: string;
    categoryId: string;
    cents: number;
    on: string;
    fromAccountId?: string;
  }) {
    await prisma.expense.create({
      data: {
        id: args.id,
        status: "POSTED",
        spentOn: day(args.on),
        amountCents: args.cents,
        vendorTaxCents: 0,
        vendorName: "cmp3",
        supplierId: args.supplierId,
        categoryId: args.categoryId,
        paidFromAccountId: args.fromAccountId ?? bank,
        submittedByUserId: ownerId,
        postedByUserId: ownerId,
      },
    });
    expenseIds.push(args.id);
    const entry = await prisma.journalEntry.create({
      data: {
        sourceType: "EXPENSE",
        sourceId: args.id,
        eventKind: "EXPENSE_POSTED",
        entryDate: day(args.on),
        periodKey: args.on.slice(0, 7),
        memo: "cmp3 test payment",
        lines: {
          create: [
            { ledgerAccountId: expenseAccount, debitCents: args.cents },
            { ledgerAccountId: args.fromAccountId ?? bank, creditCents: args.cents },
          ],
        },
      },
    });
    entryIds.push(entry.id);
  }

  beforeAll(async () => {
    process.env.COMPLIANCE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    bank = (await prisma.ledgerAccount.findFirstOrThrow({ where: { systemRole: "BANK" } })).id;
    await prisma.ledgerAccount.create({
      data: { id: expenseAccount, name: `CMP3 expense ${tag}`, type: "EXPENSE", description: "test" },
    });
    for (const [id, name, box] of [
      [necCategory, `CMP3 services ${tag}`, "NEC_1"],
      [rentCategory, `CMP3 rent ${tag}`, "MISC_1"],
      [mysteryCategory, `CMP3 mystery ${tag}`, null],
    ] as const) {
      await prisma.expenseCategory.create({
        data: { id, name, description: "test", ledgerAccountId: expenseAccount, form1099Box: box },
      });
    }
    await prisma.supplier.createMany({
      data: [
        { id: necSupplier, name: `CMP3 NEC ${tag}`, legalName: "NEC Services LLC", is1099Vendor: true, taxIdOnFile: true, tinType: "EIN", tinLast4: "6789", w9ReceivedOn: day("2026-01-10") },
        { id: rentSupplier, name: `CMP3 Rent ${tag}`, legalName: "Rent Holdings LLC", is1099Vendor: true, taxIdOnFile: false },
        { id: smallSupplier, name: `CMP3 Small ${tag}`, is1099Vendor: true, taxIdOnFile: false },
      ],
    });
    // The NEC supplier's encrypted TIN, recorded the way the W-9 flow records it.
    const { recordSupplierTin } = await import("@/domains/compliance/w9");
    await recordSupplierTin(ownerId, necSupplier, { legalName: "NEC Services LLC", tinType: "EIN", tin: "123456789" });

    // $2,500 of services (over the $2,000 threshold), $2,100 of rent, $900 of
    // services to the small supplier (under), $700 unclassified to the NEC supplier.
    await paidExpense({ id: `cmp3-e1-${tag}`, supplierId: necSupplier, categoryId: necCategory, cents: 250000, on: "2026-03-05" });
    await paidExpense({ id: `cmp3-e2-${tag}`, supplierId: rentSupplier, categoryId: rentCategory, cents: 210000, on: "2026-04-05" });
    await paidExpense({ id: `cmp3-e3-${tag}`, supplierId: smallSupplier, categoryId: necCategory, cents: 90000, on: "2026-05-05" });
    await paidExpense({ id: `cmp3-e4-${tag}`, supplierId: necSupplier, categoryId: mysteryCategory, cents: 70000, on: "2026-06-05" });

    await saveBusinessFacts(ownerId, {
      entityType: "SINGLE_MEMBER_LLC",
      ein: "12-3456789",
      sosReportMonth: null,
      truckGvwrLbs: null,
      employees: 0,
      hasHomeOffice: false,
      payer: {
        businessLegalName: "Robinson Appliance Rentals LLC",
        businessAddress: "1 Sample Street",
        businessCity: "Greeley",
        businessState: "CO",
        businessZip: "80631",
        businessPhone: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { entryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    await prisma.expense.deleteMany({ where: { id: { in: expenseIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [necSupplier, rentSupplier, smallSupplier] } } });
    await prisma.expenseCategory.deleteMany({ where: { id: { in: [necCategory, rentCategory, mysteryCategory] } } });
    await prisma.ledgerAccount.deleteMany({ where: { id: expenseAccount } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [necSupplier, rentSupplier, smallSupplier, mysteryCategory, "singleton"] } } });
    await prisma.complianceProfile.deleteMany({});
    delete process.env.COMPLIANCE_ENCRYPTION_KEY;
  });

  it("totals follow the books basis: classified boxes, threshold, unclassified kept apart", async () => {
    const computed = await compute1099Year(2026);
    expect(computed.thresholdCents).toBe(200000);
    const nec = computed.suppliers.find((s) => s.supplierId === necSupplier);
    expect(nec?.necCents).toBe(250000);
    expect(nec?.unclassifiedCents).toBe(70000);
    expect(computed.necFilers.map((s) => s.supplierId)).toContain(necSupplier);
    expect(computed.miscFilers.map((s) => s.supplierId)).toContain(rentSupplier);
    expect(computed.necFilers.map((s) => s.supplierId)).not.toContain(smallSupplier);
    expect(computed.unclassifiedCategories).toContainEqual(
      expect.objectContaining({ categoryId: mysteryCategory, cents: 70000 }),
    );
  });

  it("prepared data carries amounts and last-4s only — never a full tax ID", async () => {
    const computed = await compute1099Year(2026);
    const data = preparedDataFor1099(computed, "NEC");
    const text = JSON.stringify(data);
    expect(text).toContain("6789");
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("12-3456789");
    expect((data.recipients as { supplierId: string }[]).map((r) => r.supplierId)).toContain(necSupplier);
  });

  it("classifying the mystery category moves its amount into the box on re-prepare", async () => {
    await setCategory1099Box(ownerId, mysteryCategory, "NEC_1");
    const computed = await compute1099Year(2026);
    const nec = computed.suppliers.find((s) => s.supplierId === necSupplier);
    expect(nec?.necCents).toBe(320000);
    expect(nec?.unclassifiedCents).toBe(0);
    expect(computed.unclassifiedCategories.map((c) => c.categoryId)).not.toContain(mysteryCategory);
    await setCategory1099Box(ownerId, mysteryCategory, null);
  });

  it("the payer identity comes from business facts, and outputs carry the approved amounts", async () => {
    const identity = await payerIdentity();
    expect(identity.party.name).toBe("Robinson Appliance Rentals LLC");
    expect(identity.party.tin).toBe("123456789");
    const computed = await compute1099Year(2026);
    const data = preparedDataFor1099(computed, "NEC");
    const rows = (data.recipients as { supplierId: string; necCents: number; misc1Cents: number; misc3Cents: number }[])
      .filter((r) => r.supplierId === necSupplier)
      .map((r) => ({ supplierId: r.supplierId, necCents: r.necCents, misc1Cents: r.misc1Cents, misc3Cents: r.misc3Cents }));
    const outputs = await build1099Outputs("NEC", 2026, rows);
    expect(outputs.csvFiles).toHaveLength(1);
    expect(outputs.csvFiles[0]).toContain("2500.00");
    expect(outputs.csvFiles[0]).toContain("12-3456789");
    expect(outputs.copyPdfs).toHaveLength(1);
    expect(outputs.copyPdfs[0]!.bytes.length).toBeGreaterThan(1000);
  });
});
