import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateEnd, businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { loadApplianceTaxSteps, type PurchaseTaxStep } from "./next-step";
import { loadReceiptTaxSteps, type ReceiptTaxLine } from "@/domains/purchasing/receipt-tax";
import { allocateAcrossLines } from "./allocate";
import { toCsv } from "@/lib/csv";

/**
 * W-15 — tax proof. One appliance (or one delivery of parts) answers four questions: how it was acquired,
 * what it cost, which single tax outcome applies, and where the paperwork is. The audit pack is the same
 * proof for every appliance and part bought in a date range.
 */

export type ProofUseTaxRow = {
  jurisdiction: string; status: string; amountCents: number;
  returnName: string | null; periodLabel: string | null; filedOn: Date | null; confirmationNumber: string | null;
};
export type ProofLink = { label: string; href: string };

export type TaxProof = {
  acquired: { kind: "PURCHASE"; purchaseId: string; seller: string; reference: string | null } | { kind: "DIRECT" };
  purchasedOn: Date | null;
  priceCents: number | null;
  step: PurchaseTaxStep;
  sellerTaxPaidCents: number | null;
  useTaxReportedCents: number;
  useTaxDueCents: number;
  useTaxRows: ProofUseTaxRow[];
  receipts: ProofLink[];
};

const useTaxSelect = {
  sourceId: true, status: true, useTaxDueCents: true,
  jurisdiction: { select: { name: true } },
  filingPeriod: { select: { status: true, periodStart: true, periodEnd: true, filedOn: true, confirmationNumber: true,
    filingAccount: { select: { name: true } } } },
} satisfies Prisma.PurchaseUseTaxSelect;

type UseTaxRecord = Prisma.PurchaseUseTaxGetPayload<{ select: typeof useTaxSelect }>;

function proofRows(rows: UseTaxRecord[]): ProofUseTaxRow[] {
  return rows.map((r) => ({
    jurisdiction: r.jurisdiction.name, status: r.status, amountCents: r.useTaxDueCents,
    returnName: r.filingPeriod?.filingAccount.name ?? null,
    periodLabel: r.filingPeriod ? businessDateKey(r.filingPeriod.periodStart) + " to " + businessDateKey(r.filingPeriod.periodEnd) : null,
    filedOn: r.filingPeriod?.status === "FILED" ? r.filingPeriod.filedOn : null,
    confirmationNumber: r.filingPeriod?.status === "FILED" ? r.filingPeriod.confirmationNumber : null,
  }));
}
const sum = (rows: ProofUseTaxRow[], status: string) =>
  rows.filter((r) => r.status === status).reduce((total, r) => total + r.amountCents, 0);

const applianceSelect = {
  id: true, assetNumber: true, manufacturer: true, model: true, serialNumber: true, purchaseDate: true,
  acquisitionCostCents: true, acquisitionTaxPaidCents: true, acquisitionReceiptPhotoId: true,
  applianceType: { select: { name: true } },
  purchase: { select: { id: true, reference: true, sellerName: true, supplier: { select: { name: true } },
    documents: { orderBy: [{ pageOrder: "asc" }], select: { photoId: true, pageOrder: true } } } },
} satisfies Prisma.ApplianceSelect;
type ApplianceRecord = Prisma.ApplianceGetPayload<{ select: typeof applianceSelect }>;

function receiptsFor(a: ApplianceRecord): ProofLink[] {
  const links = (a.purchase?.documents ?? []).map((d) => ({ label: "Receipt page " + d.pageOrder, href: privatePhotoReadPath(d.photoId) }));
  if (a.acquisitionReceiptPhotoId) links.push({ label: "Receipt photo", href: privatePhotoReadPath(a.acquisitionReceiptPhotoId) });
  return links;
}

function buildProof(a: ApplianceRecord, step: PurchaseTaxStep, rows: UseTaxRecord[]): TaxProof {
  const useRows = proofRows(rows);
  return {
    acquired: a.purchase
      ? { kind: "PURCHASE", purchaseId: a.purchase.id, seller: a.purchase.supplier?.name ?? a.purchase.sellerName ?? "Unknown seller", reference: a.purchase.reference }
      : { kind: "DIRECT" },
    purchasedOn: a.purchaseDate, priceCents: a.acquisitionCostCents, step,
    sellerTaxPaidCents: a.acquisitionTaxPaidCents,
    useTaxReportedCents: sum(useRows, "FILED"), useTaxDueCents: sum(useRows, "DUE"),
    useTaxRows: useRows, receipts: receiptsFor(a),
  };
}

export async function getApplianceTaxProof(applianceId: string, now = new Date()): Promise<TaxProof | null> {
  const appliance = await prisma.appliance.findUnique({ where: { id: applianceId }, select: applianceSelect });
  if (!appliance) return null;
  const [steps, rows] = await Promise.all([
    loadApplianceTaxSteps(prisma, [applianceId], now),
    prisma.purchaseUseTax.findMany({ where: { sourceType: "APPLIANCE", sourceId: applianceId }, select: useTaxSelect, orderBy: [{ jurisdictionId: "asc" }] }),
  ]);
  return buildProof(appliance, steps.get(applianceId)!, rows);
}

// ---------------------------------------------------------------------------
// Audit pack
// ---------------------------------------------------------------------------

export const AUDIT_PACK_COLUMNS = [
  "Kind", "Asset number", "Type or part", "Manufacturer", "Model", "Serial number", "Seller", "Purchase date",
  "Receipt number", "Price", "Seller tax paid", "Use tax reported", "Use tax due (not yet filed)",
  "Return", "Return period", "Filed on", "Confirmation number", "Tax outcome", "Receipt pages",
] as const;

export type AuditPackRow = {
  kind: "Appliance" | "Part";
  assetNumber: string; item: string; manufacturer: string; model: string; serial: string; seller: string;
  purchasedOn: Date | null; receiptNumber: string; priceCents: number | null;
  sellerTaxPaidCents: number | null; useTaxReportedCents: number; useTaxDueCents: number;
  returnName: string; periodLabel: string; filedOn: Date | null; confirmationNumber: string; outcome: string;
  receipts: ProofLink[]; recordHref: string;
};

export type AuditPack = {
  from: string; to: string; generatedAt: Date;
  rows: AuditPackRow[]; undatedAppliances: number;
  totals: { priceCents: number; sellerTaxPaidCents: number; useTaxReportedCents: number; useTaxDueCents: number };
};

export function parseAuditRange(from: string | undefined, to: string | undefined, now = new Date()): { from: string; to: string } | { error: string } {
  const end = to || businessDateKey(now);
  const start = from || end.slice(0, 4) + "-01-01";
  if (!businessDateFromKey(start) || !businessDateFromKey(end)) return { error: "Enter both dates as real calendar dates." };
  if (start > end) return { error: "The start date must be on or before the end date." };
  return { from: start, to: end };
}

const firstOrDash = (values: (string | null | undefined)[]) => [...new Set(values.filter(Boolean) as string[])].join("; ");

export async function buildAuditPack(fromKey: string, toKey: string, now = new Date()): Promise<AuditPack> {
  const start = businessDateFromKey(fromKey);
  if (!start || !businessDateFromKey(toKey)) throw new Error("Invalid audit date range.");
  const end = businessDateEnd(toKey);

  const appliances = await prisma.appliance.findMany({
    where: { purchaseDate: { gte: start, lte: end } },
    orderBy: [{ purchaseDate: "asc" }, { assetNumber: "asc" }], select: applianceSelect,
  });
  const undatedAppliances = await prisma.appliance.count({ where: { purchaseDate: null } });
  const steps = await loadApplianceTaxSteps(prisma, appliances.map((a) => a.id), now);
  const useRows = await prisma.purchaseUseTax.findMany({
    where: { sourceType: "APPLIANCE", sourceId: { in: appliances.map((a) => a.id) } }, select: useTaxSelect,
    orderBy: [{ jurisdictionId: "asc" }],
  });
  const rows: AuditPackRow[] = appliances.map((a) => {
    const proof = buildProof(a, steps.get(a.id)!, useRows.filter((r) => r.sourceId === a.id));
    const filed = proof.useTaxRows.filter((r) => r.status === "FILED");
    return {
      kind: "Appliance", assetNumber: a.assetNumber, item: a.applianceType.name, manufacturer: a.manufacturer ?? "",
      model: a.model ?? "", serial: a.serialNumber ?? "",
      seller: proof.acquired.kind === "PURCHASE" ? proof.acquired.seller : "Added without a purchase record",
      purchasedOn: a.purchaseDate, receiptNumber: a.purchase?.reference ?? "", priceCents: a.acquisitionCostCents,
      sellerTaxPaidCents: a.acquisitionTaxPaidCents, useTaxReportedCents: proof.useTaxReportedCents,
      useTaxDueCents: proof.useTaxDueCents,
      returnName: firstOrDash(filed.map((r) => r.returnName)), periodLabel: firstOrDash(filed.map((r) => r.periodLabel)),
      filedOn: filed[0]?.filedOn ?? null, confirmationNumber: firstOrDash(filed.map((r) => r.confirmationNumber)),
      outcome: proof.step.headline, receipts: proof.receipts, recordHref: "/desk/inventory/" + a.id,
    };
  });

  // Parts: every priced line on a delivery whose receipt date is in range.
  const receipts = await prisma.purchaseOrderReceiptTax.findMany({
    where: { createdAt: { gte: start, lte: end } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { receiptOperation: { select: { id: true, purchaseOrder: { select: { supplier: { select: { name: true } } } } } } },
  });
  const receiptSteps = new Map((await loadReceiptTaxSteps(prisma, receipts.map((r) => r.id), now)).map((s) => [s.receiptTaxId, s]));
  const partUse = receipts.length ? await prisma.purchaseUseTax.findMany({
    where: { sourceType: "PURCHASE_ORDER_LINE", OR: receipts.map((r) => ({ sourceId: { startsWith: r.receiptOperationId + ":" } })) },
    select: useTaxSelect,
  }) : [];
  for (const receipt of receipts) {
    const lines = receipt.lines as unknown as ReceiptTaxLine[];
    const step = receiptSteps.get(receipt.id)!;
    const amounts = lines.map((l) => (l.costCents ?? 0) * l.quantity);
    const taxShares = receipt.sellerTaxKind === "COLORADO" && amounts.some((a) => a > 0) ? allocateAcrossLines(receipt.sellerTaxCents, amounts) : amounts.map(() => 0);
    for (const [i, line] of lines.entries()) {
      const mine = proofRows(partUse.filter((r) => r.sourceId === receipt.receiptOperationId + ":" + line.lineId));
      const filed = mine.filter((r) => r.status === "FILED");
      rows.push({
        kind: "Part", assetNumber: "", item: line.description + " × " + line.quantity, manufacturer: "", model: "", serial: "",
        seller: receipt.receiptOperation.purchaseOrder.supplier?.name ?? "Unknown supplier",
        purchasedOn: receipt.createdAt, receiptNumber: "", priceCents: line.costCents === null ? null : amounts[i]!,
        sellerTaxPaidCents: receipt.sellerTaxKind === "COLORADO" ? taxShares[i]! : null,
        useTaxReportedCents: sum(mine, "FILED"), useTaxDueCents: sum(mine, "DUE"),
        returnName: firstOrDash(filed.map((r) => r.returnName)), periodLabel: firstOrDash(filed.map((r) => r.periodLabel)),
        filedOn: filed[0]?.filedOn ?? null, confirmationNumber: firstOrDash(filed.map((r) => r.confirmationNumber)),
        outcome: step.headline, receipts: [], recordHref: "/desk/purchase-orders/" + receipt.purchaseOrderId,
      });
    }
  }
  rows.sort((a, b) => (a.purchasedOn?.getTime() ?? 0) - (b.purchasedOn?.getTime() ?? 0));
  const totals = rows.reduce((t, r) => ({
    priceCents: t.priceCents + (r.priceCents ?? 0), sellerTaxPaidCents: t.sellerTaxPaidCents + (r.sellerTaxPaidCents ?? 0),
    useTaxReportedCents: t.useTaxReportedCents + r.useTaxReportedCents, useTaxDueCents: t.useTaxDueCents + r.useTaxDueCents,
  }), { priceCents: 0, sellerTaxPaidCents: 0, useTaxReportedCents: 0, useTaxDueCents: 0 });
  return { from: fromKey, to: toKey, generatedAt: now, rows, undatedAppliances, totals };
}

// ---------------------------------------------------------------------------
// Spreadsheet export (stable columns; the shared writer keeps text from running as a formula)
// ---------------------------------------------------------------------------

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
const day = (date: Date | null) => (date ? businessDateKey(date) : "");

export function auditPackCsv(pack: AuditPack): string {
  return toCsv(
    AUDIT_PACK_COLUMNS.map((header) => ({ key: header, header })),
    pack.rows.map((r) => ({
      "Kind": r.kind, "Asset number": r.assetNumber, "Type or part": r.item, "Manufacturer": r.manufacturer,
      "Model": r.model, "Serial number": r.serial, "Seller": r.seller, "Purchase date": day(r.purchasedOn),
      "Receipt number": r.receiptNumber, "Price": dollars(r.priceCents), "Seller tax paid": dollars(r.sellerTaxPaidCents),
      "Use tax reported": dollars(r.useTaxReportedCents), "Use tax due (not yet filed)": dollars(r.useTaxDueCents),
      "Return": r.returnName, "Return period": r.periodLabel, "Filed on": day(r.filedOn),
      "Confirmation number": r.confirmationNumber, "Tax outcome": r.outcome,
      "Receipt pages": r.receipts.map((l) => l.href).join(" "),
    } satisfies Record<(typeof AUDIT_PACK_COLUMNS)[number], string>)),
  );
}
