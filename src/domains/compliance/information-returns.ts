import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { decryptField } from "@/lib/field-crypto";
import { ruleAsOf } from "@/domains/rules/reads";
import { businessDateFromKey } from "@/lib/business-date";
import { getComplianceProfile } from "./profile";
import { buildIrisCsv, dollars, irisBatches, type IrisParty, type IrisRow } from "./iris-csv";
import { fill1099MiscCopyB, fill1099NecCopyB, type PartyBlock } from "./pdf-forms";

/**
 * CMP-3 — 1099-NEC / 1099-MISC preparation.
 *
 * Amounts come from the books on exactly the basis the year-end 1099
 * review already uses (source-confirmed expense journals: EXPENSE_POSTED
 * and EXPENSE_VOIDED, paid from a payment-source account), so the review
 * and the filing can never disagree. Payments from any other account are
 * not in the totals: a card account is not a payment source, and card
 * payments are the card company's to report on 1099-K. Each expense
 * category carries its 1099 box (ExpenseCategory.form1099Box); amounts in
 * unclassified categories are reported as unclassified — never guessed
 * into a box.
 *
 * Prepared filing data holds NO full tax IDs (the CMP-1 guard refuses
 * them). The outputs that need full TINs — the IRIS CSV and the filled
 * recipient copies — are built at submit/download time from the encrypted
 * records, after the owner's approval has bound the numbers by hash.
 */

export type Form1099Box = "NEC_1" | "MISC_1" | "MISC_3";

export interface Supplier1099Totals {
  supplierId: string;
  name: string;
  legalName: string | null;
  tinLast4: string | null;
  tinType: "SSN" | "EIN" | null;
  hasW9: boolean;
  necCents: number;
  misc1Cents: number;
  misc3Cents: number;
  unclassifiedCents: number;
  /** Paid from a non-payment-source account (e.g. a card): excluded, and not source-confirmed. */
  unsupportedCents: number;
}

export interface Year1099 {
  year: number;
  thresholdCents: number;
  suppliers: Supplier1099Totals[];
  /** Suppliers at or over the threshold on a classified form. */
  necFilers: Supplier1099Totals[];
  miscFilers: Supplier1099Totals[];
  /** Expense categories whose 1099 box is not classified yet, with the
   * year's amounts — the owner classifies these on the filing page. */
  unclassifiedCategories: { categoryId: string; name: string; cents: number }[];
}

const CAP = 20000;

export async function compute1099Year(year: number): Promise<Year1099> {
  return prisma.$transaction(
    async (tx) => {
      const startDate = new Date(Date.UTC(year, 0, 1));
      const endDate = new Date(Date.UTC(year + 1, 0, 1));
      const journals = await tx.journalEntry.findMany({
        where: {
          sourceType: "EXPENSE",
          entryDate: { gte: startDate, lt: endDate },
          eventKind: { in: ["EXPENSE_POSTED", "EXPENSE_VOIDED"] },
        },
        include: { lines: { include: { ledgerAccount: { select: { type: true } } } } },
        orderBy: [{ entryDate: "asc" }, { entryNumber: "asc" }],
        take: CAP + 1,
      });
      if (journals.length > CAP) throw new Error("Too many expense records for one year — prepare the 1099s with your CPA this year.");
      const expenses = await tx.expense.findMany({
        where: { id: { in: [...new Set(journals.map((j) => j.sourceId))] } },
        select: {
          id: true,
          supplierId: true,
          paidFromAccountId: true,
          categoryId: true,
          category: { select: { form1099Box: true, name: true } },
        },
      });
      const expenseById = new Map(expenses.map((e) => [e.id, e]));
      const supplierIds = [...new Set(expenses.flatMap((e) => (e.supplierId ? [e.supplierId] : [])))];
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: supplierIds }, is1099Vendor: true },
        select: { id: true, name: true, legalName: true, tinLast4: true, tinType: true, w9ReceivedOn: true },
      });
      const supplierById = new Map(suppliers.map((s) => [s.id, s]));
      const accounts = await tx.ledgerAccount.findMany({
        where: { id: { in: expenses.map((e) => e.paidFromAccountId) } },
        select: { id: true, isPaymentSource: true },
      });
      const paymentSource = new Set(accounts.filter((a) => a.isPaymentSource).map((a) => a.id));

      const totals = new Map<string, Supplier1099Totals>();
      const categoryUnclassified = new Map<string, { name: string; cents: number }>();
      const blank = (s: (typeof suppliers)[number]): Supplier1099Totals => ({
        supplierId: s.id,
        name: s.name,
        legalName: s.legalName,
        tinLast4: s.tinLast4,
        tinType: (s.tinType as "SSN" | "EIN" | null) ?? null,
        hasW9: s.w9ReceivedOn !== null,
        necCents: 0,
        misc1Cents: 0,
        misc3Cents: 0,
        unclassifiedCents: 0,
        unsupportedCents: 0,
      });
      for (const journal of journals) {
        const expense = expenseById.get(journal.sourceId);
        if (!expense?.supplierId) continue;
        const supplier = supplierById.get(expense.supplierId);
        if (!supplier) continue;
        const paid = journal.lines
          .filter((l) => l.ledgerAccountId === expense.paidFromAccountId)
          .reduce((n, l) => n + (l.creditCents - l.debitCents), 0);
        if (!paid) continue;
        const row = totals.get(supplier.id) ?? blank(supplier);
        if (!paymentSource.has(expense.paidFromAccountId)) {
          row.unsupportedCents += paid;
        } else if (expense.category.form1099Box === "NEC_1") {
          row.necCents += paid;
        } else if (expense.category.form1099Box === "MISC_1") {
          row.misc1Cents += paid;
        } else if (expense.category.form1099Box === "MISC_3") {
          row.misc3Cents += paid;
        } else {
          row.unclassifiedCents += paid;
          const cat = categoryUnclassified.get(expense.categoryId) ?? { name: expense.category.name, cents: 0 };
          cat.cents += paid;
          categoryUnclassified.set(expense.categoryId, cat);
        }
        totals.set(supplier.id, row);
      }
      const threshold = (await ruleAsOf<number>("us.1099.threshold", businessDateFromKey(`${year}-01-01`)!, tx)).value;
      const all = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
      return {
        year,
        thresholdCents: threshold,
        suppliers: all,
        necFilers: all.filter((s) => s.necCents >= threshold),
        miscFilers: all.filter((s) => s.misc1Cents + s.misc3Cents >= threshold),
        unclassifiedCategories: [...categoryUnclassified.entries()]
          .filter(([, v]) => v.cents !== 0)
          .map(([categoryId, v]) => ({ categoryId, name: v.name, cents: v.cents })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
}

/** The data a 1099 filing is prepared with — amounts and last-4s only, never a full TIN. */
export function preparedDataFor1099(computed: Year1099, form: "NEC" | "MISC"): Record<string, unknown> {
  const row = (s: Supplier1099Totals) => ({
    supplierId: s.supplierId,
    name: s.legalName ?? s.name,
    tinLast4: s.tinLast4,
    hasW9: s.hasW9,
    necCents: s.necCents,
    misc1Cents: s.misc1Cents,
    misc3Cents: s.misc3Cents,
    unclassifiedCents: s.unclassifiedCents,
    unsupportedCents: s.unsupportedCents,
  });
  const filers = form === "NEC" ? computed.necFilers : computed.miscFilers;
  return {
    form: form === "NEC" ? "1099-NEC" : "1099-MISC",
    year: computed.year,
    thresholdCents: computed.thresholdCents,
    recipients: filers.map(row),
    belowThreshold: computed.suppliers.filter((s) => !filers.includes(s)).map(row),
    unclassified: computed.suppliers.filter((s) => s.unclassifiedCents !== 0).map(row),
    unclassifiedCategories: computed.unclassifiedCategories,
  };
}

/** The payer block for outputs, from the business facts. Throws a plain message when it is incomplete. */
export async function payerIdentity(): Promise<{ party: PartyBlock; iris: IrisParty }> {
  const profile = await getComplianceProfile();
  if (!profile?.businessLegalName || !profile.businessAddress || !profile.businessCity || !profile.businessState || !profile.businessZip) {
    throw new Error("Add the business name and mailing address on the Business facts screen first — they print as the payer on every 1099.");
  }
  if (!profile.einEncrypted) {
    throw new Error("Add the business EIN on the Business facts screen first — it prints as the payer's tax ID on every 1099.");
  }
  const ein = decryptField(profile.einEncrypted);
  const party: PartyBlock = {
    name: profile.businessLegalName,
    street: profile.businessAddress,
    city: profile.businessCity,
    state: profile.businessState,
    zip: profile.businessZip,
    country: "US",
    phone: profile.businessPhone ?? undefined,
    tin: ein,
  };
  const iris: IrisParty = {
    tinType: "EIN",
    tinDigits: ein,
    nameType: "B",
    businessName: profile.businessLegalName,
    country: "US",
    addressLine1: profile.businessAddress,
    city: profile.businessCity,
    state: profile.businessState,
    zip: profile.businessZip,
    phone: profile.businessPhone ?? undefined,
  };
  return { party, iris };
}

export interface Prepared1099Row {
  supplierId: string;
  necCents: number;
  misc1Cents: number;
  misc3Cents: number;
}

/**
 * Builds the filing outputs for an APPROVED 1099 filing from its prepared
 * (hash-bound) rows: the IRIS portal CSV batches and one filled Copy B
 * per recipient. Full TINs are decrypted here, inside output building
 * only — the amounts always come from the approved preparation, never
 * recomputed live.
 */
export async function build1099Outputs(
  form: "NEC" | "MISC",
  year: number,
  rows: Prepared1099Row[],
): Promise<{ csvFiles: string[]; copyPdfs: { supplierId: string; bytes: Uint8Array }[] }> {
  const { party, iris } = await payerIdentity();
  const supplierRows = await prisma.supplier.findMany({
    where: { id: { in: rows.map((f) => f.supplierId) } },
    select: { id: true, tinEncrypted: true, tinType: true, legalName: true, name: true },
  });
  const byId = new Map(supplierRows.map((s) => [s.id, s]));
  const irisRows: IrisRow[] = [];
  const copyPdfs: { supplierId: string; bytes: Uint8Array }[] = [];
  for (const filer of rows) {
    const record = byId.get(filer.supplierId);
    if (!record?.tinEncrypted || !record.tinType) {
      throw new Error(`${record?.name ?? "A supplier"} has no tax ID on file — record the W-9 before building the filing outputs.`);
    }
    const tin = decryptField(record.tinEncrypted);
    const recipientIris: IrisParty = {
      tinType: record.tinType as "SSN" | "EIN",
      tinDigits: tin,
      nameType: record.tinType === "EIN" ? "B" : "I",
      businessName: record.tinType === "EIN" ? (record.legalName ?? record.name) : undefined,
      firstName: record.tinType === "SSN" ? (record.legalName ?? record.name).split(" ").slice(0, -1).join(" ") || undefined : undefined,
      lastName: record.tinType === "SSN" ? (record.legalName ?? record.name).split(" ").slice(-1)[0] : undefined,
      country: "US",
    };
    const recipientParty: PartyBlock = { name: record.legalName ?? record.name, country: "US", tin };
    if (form === "NEC") {
      irisRows.push({
        recipient: recipientIris,
        boxes: { "Box 1 - Nonemployee Compensation": dollars(filer.necCents), "Box 4 - Federal income tax withheld": "" },
      });
      copyPdfs.push({
        supplierId: filer.supplierId,
        bytes: await fill1099NecCopyB({ year, payer: party, recipient: recipientParty, box1aDollars: dollars(filer.necCents) }),
      });
    } else {
      irisRows.push({
        recipient: recipientIris,
        boxes: {
          "Box 1 - Rents": filer.misc1Cents ? dollars(filer.misc1Cents) : "",
          "Box 3 - Other income": filer.misc3Cents ? dollars(filer.misc3Cents) : "",
        },
      });
      copyPdfs.push({
        supplierId: filer.supplierId,
        bytes: await fill1099MiscCopyB({
          year,
          payer: party,
          recipient: recipientParty,
          box1Dollars: filer.misc1Cents ? dollars(filer.misc1Cents) : undefined,
          box3Dollars: filer.misc3Cents ? dollars(filer.misc3Cents) : undefined,
        }),
      });
    }
  }
  const csvFiles = irisBatches(irisRows).map((batch) => buildIrisCsv(form === "NEC" ? "1099-NEC" : "1099-MISC", year, iris, batch));
  return { csvFiles, copyPdfs };
}

/** OWNER/ADMIN: classify an expense category's 1099 box (or clear it). */
export async function setCategory1099Box(actorId: string, categoryId: string, box: Form1099Box | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "ExpenseCategory" WHERE "id" = ${categoryId} FOR UPDATE`;
    const category = await tx.expenseCategory.findUnique({ where: { id: categoryId }, select: { id: true, form1099Box: true } });
    if (!category) throw new Error("That expense category no longer exists.");
    await tx.expenseCategory.update({ where: { id: categoryId }, data: { form1099Box: box } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "books.category_1099_box",
        entityType: "ExpenseCategory",
        entityId: categoryId,
        newValue: { form1099Box: box },
      },
    });
  });
}
