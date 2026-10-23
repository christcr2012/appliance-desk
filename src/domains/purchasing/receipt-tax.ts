import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { PurchaseTaxContextPendingError, recordUseTaxForPurchase } from "@/domains/tax/use-tax";
import { explainTaxContext } from "@/domains/tax/purchase-tax-explain";
import { coveringUseTaxReturn, nextPurchaseTaxStep, type PurchaseTaxStep, type PurchaseTaxSubject } from "@/domains/tax/next-step";
import { formatMoney } from "@/lib/money-ui";
import type { PurchaseTaxAnswer } from "./purchases";

/**
 * W-2 — the same plain tax question for parts that arrive on a purchase-order receipt.
 * The answer applies to every priced line of that one receipt; the use-tax rows hang off
 * `PURCHASE_ORDER_LINE` sources named `<receipt id>:<line id>` and reuse the appliance pipeline.
 */

export type ReceiptTaxInput = { answer: PurchaseTaxAnswer; sellerTaxCents: number; otherState?: string | null };
export type ReceiptTaxLine = { lineId: string; description: string; quantity: number; costCents: number | null; /** Bought to resell: no use tax when it arrives. */ forResale?: boolean };

type Tx = Prisma.TransactionClient;

export function validateReceiptTax(input: ReceiptTaxInput): { taxed: boolean; state: string | null } {
  const state = input.otherState?.trim().replace(/\s+/g, " ") || null;
  const taxed = input.answer === "YES_COLORADO" || input.answer === "YES_OTHER_STATE";
  if (!["YES_COLORADO", "YES_OTHER_STATE", "NO", "LATER"].includes(input.answer)) throw new Error("Answer the tax question.");
  if (input.answer === "YES_OTHER_STATE" && !state) throw new Error("Type which state's tax was charged.");
  if (input.answer !== "YES_OTHER_STATE" && state) throw new Error("A state applies only to another state's tax.");
  if (taxed && !(Number.isSafeInteger(input.sellerTaxCents) && input.sellerTaxCents > 0)) throw new Error("Enter the tax printed on the receipt.");
  if (!taxed && input.sellerTaxCents !== 0) throw new Error("Seller tax can only be entered when the seller charged tax.");
  return { taxed, state };
}

const KIND = { YES_COLORADO: "COLORADO", YES_OTHER_STATE: "OTHER_STATE", NO: "NONE", LATER: "UNKNOWN" } as const;
const STORED_ANSWER = { YES_COLORADO: "SELLER_CHARGED", YES_OTHER_STATE: "LATER", NO: "NONE_CHARGED", LATER: "LATER" } as const;

/** Create/refresh use-tax rows for the priced lines. Context not set up yet → no rows (the To do says why). */
async function applyReceiptUseTax(
  tx: Tx, receiptId: string, answer: PurchaseTaxAnswer, sellerTaxCents: number, lines: ReceiptTaxLine[], when: Date,
): Promise<void> {
  if (answer === "LATER" || answer === "YES_OTHER_STATE") return;
  const priced = lines.filter((l) => !l.forResale && l.costCents !== null && l.costCents * l.quantity > 0);
  if (!priced.length) return;
  const amounts = priced.map((l) => l.costCents! * l.quantity);
  const taxShares = allocateAcrossLines(sellerTaxCents, amounts);
  try {
    for (const [i, line] of priced.entries()) {
      await recordUseTaxForPurchase(tx, {
        sourceType: "PURCHASE_ORDER_LINE", sourceId: receiptId + ":" + line.lineId,
        purchasedOn: when, amountCents: amounts[i]!, vendorTaxCents: taxShares[i]!, isRentalInventory: false,
      }, { allowAuditedFiledCorrection: true });
    }
  } catch (error) {
    if (!(error instanceof PurchaseTaxContextPendingError)) throw error;
  }
}

/** Called inside the receiving transaction, after the receipt operation was claimed. */
export async function recordReceiptTaxInTx(
  tx: Tx, actorId: string,
  input: { receiptOperationId: string; purchaseOrderId: string; tax: ReceiptTaxInput; lines: ReceiptTaxLine[] }, now: Date,
): Promise<void> {
  const { state } = validateReceiptTax(input.tax);
  const received = input.lines.reduce((sum, l) => sum + (l.costCents ?? 0) * l.quantity, 0);
  await tx.purchaseOrderReceiptTax.create({
    data: {
      receiptOperationId: input.receiptOperationId, purchaseOrderId: input.purchaseOrderId,
      answer: STORED_ANSWER[input.tax.answer], sellerTaxKind: KIND[input.tax.answer],
      sellerTaxCents: input.tax.sellerTaxCents, sellerTaxState: state,
      receivedAmountCents: received, lines: input.lines as unknown as Prisma.InputJsonValue,
      revisionAt: now, recordedByUserId: actorId,
    },
  });
  await applyReceiptUseTax(tx, input.receiptOperationId, input.tax.answer, input.tax.sellerTaxCents, input.lines, now);
  await tx.auditLog.create({
    data: { userId: actorId, action: "purchase_order.receipt_tax", entityType: "PurchaseOrder", entityId: input.purchaseOrderId,
      newValue: { receiptOperationId: input.receiptOperationId, answer: input.tax.answer, sellerTaxCents: input.tax.sellerTaxCents } },
  });
}

/** Re-answer a receipt's tax question later (owner only). */
export async function updateReceiptTaxAnswer(
  actorId: string,
  input: { receiptTaxId: string; expectedRevisionAt: Date; tax: ReceiptTaxInput }, now = new Date(),
): Promise<void> {
  const { state } = validateReceiptTax(input.tax);
  await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    if (actor.role !== "OWNER") throw new Error("Only the owner can change purchase-tax evidence.");
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PurchaseOrderReceiptTax" WHERE "id" = ${input.receiptTaxId} FOR UPDATE`;
    if (locked.length !== 1) throw new Error("Receipt not found.");
    const row = await tx.purchaseOrderReceiptTax.findUniqueOrThrow({ where: { id: input.receiptTaxId } });
    if (row.revisionAt.getTime() !== input.expectedRevisionAt.getTime()) {
      throw new Error("Someone updated this receipt's tax. Reload before saving.");
    }
    const lines = row.lines as unknown as ReceiptTaxLine[];
    const existing = await tx.purchaseUseTax.count({
      where: { sourceType: "PURCHASE_ORDER_LINE", sourceId: { startsWith: row.receiptOperationId + ":" } },
    });
    if (input.tax.answer === "LATER" && existing > 0) {
      throw new Error("Review existing tax rows before clearing a recorded purchase-tax answer.");
    }
    await applyReceiptUseTax(tx, row.receiptOperationId, input.tax.answer, input.tax.sellerTaxCents, lines, row.createdAt);
    await tx.purchaseOrderReceiptTax.update({
      where: { id: row.id },
      data: {
        answer: STORED_ANSWER[input.tax.answer], sellerTaxKind: KIND[input.tax.answer],
        sellerTaxCents: input.tax.sellerTaxCents, sellerTaxState: state,
        revisionAt: new Date(Math.max(Date.now(), row.revisionAt.getTime() + 1, now.getTime())),
      },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "purchase_order.receipt_tax_answer", entityType: "PurchaseOrder", entityId: row.purchaseOrderId,
        oldValue: { answer: row.answer, sellerTaxCents: row.sellerTaxCents },
        newValue: { answer: input.tax.answer, sellerTaxCents: input.tax.sellerTaxCents } },
    });
  });
}

// ---------------------------------------------------------------------------
// The shared next step for a receipt
// ---------------------------------------------------------------------------

export type ReceiptTaxStep = PurchaseTaxStep & { subject: PurchaseTaxSubject; receiptTaxId: string; purchaseOrderId: string; revisionAt: Date };

export async function loadReceiptTaxSteps(client: Tx | typeof prisma, receiptTaxIds: readonly string[] | null, now = new Date()): Promise<ReceiptTaxStep[]> {
  const rows = await client.purchaseOrderReceiptTax.findMany({
    where: receiptTaxIds ? { id: { in: [...receiptTaxIds] } } : {},
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { receiptOperation: { select: { id: true, purchaseOrder: { select: { supplier: { select: { name: true } } } } } } },
  });
  const out: ReceiptTaxStep[] = [];
  for (const row of rows) {
    const lines = row.lines as unknown as ReceiptTaxLine[];
    const useRows = await client.purchaseUseTax.findMany({
      where: { sourceType: "PURCHASE_ORDER_LINE", sourceId: { startsWith: row.receiptOperationId + ":" } },
      select: { status: true, useTaxDueCents: true, jurisdiction: { select: { name: true } },
        filingPeriod: { select: { status: true, dueOn: true, legalDueOn: true, filedOn: true, confirmationNumber: true,
          filingAccount: { select: { name: true } } } } },
    });
    const taxed = row.sellerTaxKind === "COLORADO";
    const none = row.sellerTaxKind === "NONE";
    const unknownKind = row.sellerTaxKind === "UNKNOWN" || row.sellerTaxKind === "OTHER_STATE";
    const priced = lines.some((l) => !l.forResale && l.costCents !== null);
    let status: PurchaseTaxSubject["status"] = "UNKNOWN";
    let blocked: Awaited<ReturnType<typeof explainTaxContext>> = null;
    if (!unknownKind && priced) {
      if (useRows.some((r) => r.status === "DUE" && r.useTaxDueCents > 0)) status = "USE_TAX_DUE";
      else if (useRows.length) status = taxed && row.sellerTaxCents > 0 && !useRows.some((r) => r.useTaxDueCents > 0) ? "SALES_TAX_PAID" : "USE_TAX_PAID";
      else blocked = await explainTaxContext(client as Tx, row.createdAt, { requireElection: false });
    } else if (!unknownKind && !priced) {
      status = none ? "USE_TAX_PAID" : "SALES_TAX_PAID";
    }
    const covering = status === "UNKNOWN" || useRows.some((r) => r.status === "DUE" && !r.filingPeriod)
      ? await coveringUseTaxReturn(client as Tx, row.createdAt) : null;
    const href = "/desk/purchase-orders/" + row.purchaseOrderId;
    const subject: PurchaseTaxSubject = {
      label: "Parts received" + (row.receiptOperation.purchaseOrder.supplier ? " from " + row.receiptOperation.purchaseOrder.supplier.name : "") + " on " +
        row.createdAt.toISOString().slice(0, 10) + " (" + formatMoney(row.receivedAmountCents) + ")",
      href, status, choice: unknownKind ? "LATER" : taxed ? "SELLER_CHARGED" : "NONE_CHARGED",
      otherStateName: row.sellerTaxKind === "OTHER_STATE" ? row.sellerTaxState : null,
      otherStateTaxCents: row.sellerTaxKind === "OTHER_STATE" ? row.sellerTaxCents : null,
      recordedAt: row.createdAt, purchasedOn: row.createdAt, covering,
      blockedReason: blocked?.reason as PurchaseTaxSubject["blockedReason"] ?? null,
      blockedHref: blocked?.fixHref ?? null, blockedLabel: blocked?.fixLabel ?? null,
      useTaxRows: useRows.map((r) => ({
        jurisdictionName: r.jurisdiction.name, status: r.status, useTaxDueCents: r.useTaxDueCents,
        returnName: r.filingPeriod?.filingAccount.name ?? null,
        returnLegalDueOn: r.filingPeriod ? r.filingPeriod.legalDueOn ?? r.filingPeriod.dueOn : null,
        filedOn: r.filingPeriod?.status === "FILED" ? r.filingPeriod.filedOn : null,
        confirmationNumber: r.filingPeriod?.status === "FILED" ? r.filingPeriod.confirmationNumber : null,
      })),
    };
    out.push({ ...nextPurchaseTaxStep(subject, now), subject, receiptTaxId: row.id, purchaseOrderId: row.purchaseOrderId, revisionAt: row.revisionAt });
  }
  return out;
}
