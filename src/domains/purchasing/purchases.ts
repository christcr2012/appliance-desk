import { queueStoredFileCleanup } from "@/domains/stored-files/cleanup";
import { createHash } from "node:crypto";
import type { AcquisitionTaxStatus, Prisma, PurchaseDocumentKind, PurchaseSellerTaxKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { allocateAssetNumbers } from "@/domains/inventory/asset-numbers";
import { assetNumberPrefix } from "@/domains/inventory";
import { recordApplianceAcquisitionTaxInTx } from "@/domains/tax/acquisition";
import { loadApplianceTaxSteps, type PurchaseTaxStep } from "@/domains/tax/next-step";
import { reconcilePurchase, splitSellerTax, type TaxSplitBasis } from "./purchase-math";
import {
  MAX_PURCHASE_DOCUMENTS,
  PURCHASE_FOLDER_PATTERN,
  verifyPurchaseUploads,
} from "./purchase-documents";

/**
 * W-14 — "Record a purchase": one seller, one date, one receipt, many appliances.
 *
 * One transaction creates the purchase, every appliance (each with its own model, serial and price,
 * all linked back), the receipt pages, and the tax evidence for every appliance, or nothing at all.
 * A repeated save with the same form key returns the first result. Only the OWNER saves a tax answer
 * (the existing intake rule); an ADMIN may record the purchase with "I'll check the receipt later".
 */

export type PurchaseTaxAnswer = "YES_COLORADO" | "YES_OTHER_STATE" | "NO" | "LATER";
export const PURCHASE_TAX_ANSWERS: readonly PurchaseTaxAnswer[] = ["YES_COLORADO", "YES_OTHER_STATE", "NO", "LATER"];

export type PurchaseApplianceRow = {
  applianceTypeId: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  priceCents: number;
  condition?: string | null;
  color?: string | null;
};

export type PurchaseDocumentInput = { url: string; kind?: PurchaseDocumentKind; altText?: string | null };

export type RecordPurchaseInput = {
  /** One random value per form (letters, digits, - and _); also the receipt upload folder. */
  operationKey: string;
  supplierId?: string | null;
  sellerName?: string | null;
  purchasedOn: Date;
  reference?: string | null;
  taxAnswer: PurchaseTaxAnswer;
  /** Tax exactly as printed on the receipt, in cents. Required (> 0) for Yes answers, zero otherwise. */
  sellerTaxCents: number;
  /** Required for another state's tax. */
  otherState?: string | null;
  otherChargesCents: number;
  /** Optional cross-checks typed from the receipt itself. */
  receiptSubtotalCents?: number | null;
  receiptTotalCents?: number | null;
  notes?: string | null;
  documents: PurchaseDocumentInput[];
  appliances: PurchaseApplianceRow[];
};

export class PurchaseConflictError extends Error {
  constructor() {
    super("That form was already saved with different details. Reload the page to start a new purchase.");
    this.name = "PurchaseConflictError";
  }
}

export type RecordedPurchaseAppliance = {
  id: string;
  assetNumber: string;
  typeName: string;
  priceCents: number;
  taxShareCents: number;
  taxStatus: AcquisitionTaxStatus;
  step: PurchaseTaxStep;
};

export type RecordedPurchase = {
  purchaseId: string;
  replayed: boolean;
  sellerLabel: string;
  purchasedOn: Date;
  subtotalCents: number;
  sellerTaxCents: number;
  otherChargesCents: number;
  receiptTotalCents: number;
  taxBasis: TaxSplitBasis;
  appliances: RecordedPurchaseAppliance[];
};

const clean = (value: string | null | undefined, max: number, label: string): string | null => {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
};

function kindFor(answer: PurchaseTaxAnswer): PurchaseSellerTaxKind {
  return { YES_COLORADO: "COLORADO", YES_OTHER_STATE: "OTHER_STATE", NO: "NONE", LATER: "UNKNOWN" }[answer] as PurchaseSellerTaxKind;
}

type NormalizedPurchase = ReturnType<typeof normalizePurchase>;

/** Validate and normalize everything the person typed. Pure; no database. */
export function normalizePurchase(input: RecordPurchaseInput) {
  if (!PURCHASE_FOLDER_PATTERN.test(input.operationKey)) {
    throw new Error("This form has no valid identity. Reload the page and try again.");
  }
  if (!PURCHASE_TAX_ANSWERS.includes(input.taxAnswer)) throw new Error("Answer the tax question.");
  if (!(input.purchasedOn instanceof Date) || !Number.isFinite(input.purchasedOn.getTime())) {
    throw new Error("Enter the purchase date.");
  }
  const supplierId = input.supplierId?.trim() || null;
  const sellerName = clean(input.sellerName, 200, "Seller name");
  if (!supplierId && !sellerName) throw new Error("Choose a supplier or type who you bought from.");
  if (supplierId && sellerName) throw new Error("Choose a supplier or type a private seller, not both.");
  if (!input.appliances.length) throw new Error("Add at least one appliance.");
  if (input.appliances.length > 50) throw new Error("Record up to 50 appliances per purchase.");
  if (input.documents.length > MAX_PURCHASE_DOCUMENTS) throw new Error(`Attach up to ${MAX_PURCHASE_DOCUMENTS} receipt pages.`);

  const otherState = clean(input.otherState, 60, "State");
  if (input.taxAnswer === "YES_OTHER_STATE" && !otherState) throw new Error("Type which state's tax was charged.");
  if (input.taxAnswer !== "YES_OTHER_STATE" && otherState) throw new Error("A state applies only to another state's tax.");
  const taxed = input.taxAnswer === "YES_COLORADO" || input.taxAnswer === "YES_OTHER_STATE";
  if (taxed && input.sellerTaxCents <= 0) throw new Error("Enter the tax printed on the receipt.");
  if (!taxed && input.sellerTaxCents !== 0) throw new Error("Seller tax can only be entered when the seller charged tax.");

  const rows = input.appliances.map((row, index) => {
    const label = `Appliance ${index + 1}`;
    if (!row.applianceTypeId?.trim()) throw new Error(`${label}: choose a type.`);
    if (!Number.isSafeInteger(row.priceCents) || row.priceCents < 0) throw new Error(`${label}: enter the price.`);
    return {
      applianceTypeId: row.applianceTypeId.trim(),
      manufacturer: clean(row.manufacturer, 200, `${label} manufacturer`),
      model: clean(row.model, 200, `${label} model`),
      serialNumber: clean(row.serialNumber, 200, `${label} serial number`),
      priceCents: row.priceCents,
      condition: clean(row.condition, 200, `${label} condition`),
      color: clean(row.color, 100, `${label} color`),
    };
  });
  const math = reconcilePurchase({
    pricesCents: rows.map((row) => row.priceCents),
    sellerTaxCents: input.sellerTaxCents,
    otherChargesCents: input.otherChargesCents,
    receiptSubtotalCents: input.receiptSubtotalCents,
    receiptTotalCents: input.receiptTotalCents,
  });
  if (math.problems.length) throw new Error(math.problems[0]!);

  const urls = input.documents.map((doc) => doc.url);
  if (new Set(urls).size !== urls.length) throw new Error("A receipt page was attached twice.");
  const documents = input.documents.map((doc) => ({
    url: doc.url, kind: doc.kind ?? "RECEIPT" as PurchaseDocumentKind,
    altText: clean(doc.altText, 200, "Receipt description"),
  }));

  return {
    operationKey: input.operationKey, supplierId, sellerName,
    purchasedOn: input.purchasedOn, reference: clean(input.reference, 100, "Receipt number"),
    taxAnswer: input.taxAnswer, sellerTaxCents: input.sellerTaxCents, otherState,
    otherChargesCents: input.otherChargesCents, notes: clean(input.notes, 2000, "Notes"),
    documents, rows, math,
  };
}

function hashOf(n: NormalizedPurchase): string {
  const canonical = JSON.stringify({
    s: n.supplierId, n: n.sellerName, d: businessDateKey(n.purchasedOn), r: n.reference,
    a: n.taxAnswer, t: n.sellerTaxCents, o: n.otherState, c: n.otherChargesCents, x: n.notes,
    docs: n.documents.map((doc) => [doc.url, doc.kind, doc.altText]),
    rows: n.rows.map((row) => [row.applianceTypeId, row.manufacturer, row.model, row.serialNumber,
      row.priceCents, row.condition, row.color]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const norm = (value: string) => value.trim().toLowerCase();

async function assertSerialsAvailable(tx: Prisma.TransactionClient, rows: NormalizedPurchase["rows"]) {
  const seen: { serial: string; manufacturer: string | null }[] = [];
  for (const row of rows) {
    if (!row.serialNumber) continue;
    const serial = norm(row.serialNumber);
    const manufacturer = row.manufacturer ? norm(row.manufacturer) : null;
    if (seen.some((other) => other.serial === serial &&
        (other.manufacturer === manufacturer || other.manufacturer === null || manufacturer === null))) {
      throw new Error(`Serial number ${row.serialNumber} is on two rows of this purchase.`);
    }
    seen.push({ serial, manufacturer });
    const existing = await tx.appliance.findMany({
      where: { serialNumber: { equals: row.serialNumber, mode: "insensitive" }, archivedAt: null },
      select: { assetNumber: true, manufacturer: true },
    });
    const clash = existing.find((other) => {
      const theirs = other.manufacturer ? norm(other.manufacturer) : null;
      return theirs === manufacturer || theirs === null || manufacturer === null;
    });
    if (clash) throw new Error(`Serial number ${row.serialNumber} is already in inventory as ${clash.assetNumber}.`);
  }
}

function otherStateNote(state: string, shareCents: number, totalCents: number): string {
  return `Tax paid to ${state}: ${formatMoney(shareCents)} of ${formatMoney(totalCents)} on this receipt`;
}

/** Map the plain answer onto the existing per-appliance acquisition evidence. */
function applianceTaxInput(answer: PurchaseTaxAnswer, shareCents: number, state: string | null, totalCents: number) {
  switch (answer) {
    case "YES_COLORADO": return { choice: "SELLER_CHARGED" as const, vendorTaxCents: shareCents };
    case "NO": return { choice: "NONE_CHARGED" as const, vendorTaxCents: 0 };
    case "YES_OTHER_STATE":
      return { choice: "LATER" as const, vendorTaxCents: 0, sellerNote: otherStateNote(state!, shareCents, totalCents) };
    default: return { choice: "LATER" as const, vendorTaxCents: 0 };
  }
}

/** Read back a stored purchase in the same shape the record call returns. */
async function readRecorded(tx: Prisma.TransactionClient, purchaseId: string, replayed: boolean, now: Date): Promise<RecordedPurchase> {
  const purchase = await tx.purchase.findUniqueOrThrow({
    where: { id: purchaseId },
    include: {
      supplier: { select: { name: true } },
      appliances: {
        orderBy: [{ createdAt: "asc" }, { assetNumber: "asc" }],
        select: { id: true, assetNumber: true, acquisitionCostCents: true, acquisitionTaxStatus: true,
          applianceType: { select: { name: true } } },
      },
    },
  });
  const steps = await loadApplianceTaxSteps(tx, purchase.appliances.map((a) => a.id), now);
  const prices = purchase.appliances.map((a) => a.acquisitionCostCents ?? 0);
  const split = splitSellerTax(prices, purchase.sellerTaxCents);
  return {
    purchaseId: purchase.id, replayed,
    sellerLabel: purchase.supplier?.name ?? purchase.sellerName ?? "Unknown seller",
    purchasedOn: purchase.purchasedOn,
    subtotalCents: purchase.subtotalCents, sellerTaxCents: purchase.sellerTaxCents,
    otherChargesCents: purchase.otherChargesCents,
    receiptTotalCents: purchase.subtotalCents + purchase.sellerTaxCents + purchase.otherChargesCents,
    taxBasis: split.basis,
    appliances: purchase.appliances.map((a, i) => ({
      id: a.id, assetNumber: a.assetNumber, typeName: a.applianceType.name,
      priceCents: a.acquisitionCostCents ?? 0, taxShareCents: split.shares[i] ?? 0,
      taxStatus: a.acquisitionTaxStatus, step: steps.get(a.id)!,
    })),
  };
}

export async function recordPurchase(actorId: string, input: RecordPurchaseInput, now = new Date()): Promise<RecordedPurchase> {
  const n = normalizePurchase(input);
  await verifyPurchaseUploads(n.operationKey, n.documents.map((doc) => doc.url));
  const payloadHash = hashOf(n);

  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    if (n.taxAnswer !== "LATER" && actor.role !== "OWNER") {
      throw new Error("Only the owner can record purchase-tax evidence. Choose “I’ll check the receipt later” and the owner can answer it.");
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"purchase:" + n.operationKey}))::text AS locked`;
    const existing = await tx.purchase.findUnique({ where: { operationKey: n.operationKey }, select: { id: true, payloadHash: true } });
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new PurchaseConflictError();
      return readRecorded(tx, existing.id, true, now);
    }

    if (n.supplierId) {
      const supplier = await tx.supplier.findUnique({ where: { id: n.supplierId }, select: { archivedAt: true } });
      if (!supplier) throw new Error("That supplier no longer exists.");
      if (supplier.archivedAt) throw new Error("That supplier is archived. Restore it or type a private seller.");
    }
    const typeIds = [...new Set(n.rows.map((row) => row.applianceTypeId))];
    const types = await tx.applianceType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } });
    if (types.length !== typeIds.length) throw new Error("One of the appliance types no longer exists.");
    const typeById = new Map(types.map((type) => [type.id, type]));
    await assertSerialsAvailable(tx, n.rows);

    const kind = kindFor(n.taxAnswer);
    const purchase = await tx.purchase.create({
      data: {
        operationKey: n.operationKey, payloadHash,
        supplierId: n.supplierId, sellerName: n.sellerName,
        purchasedOn: n.purchasedOn, reference: n.reference,
        subtotalCents: n.math.subtotalCents, sellerTaxCents: n.sellerTaxCents,
        sellerTaxKind: kind, sellerTaxState: n.otherState,
        otherChargesCents: n.otherChargesCents, notes: n.notes,
        createdByUserId: actorId, taxRevisionAt: new Date(Math.max(Date.now(), now.getTime())),
      },
    });

    // Asset numbers: one counter per type prefix, handed out in row order.
    const perType = new Map<string, { prefix: string; rows: number[] }>();
    n.rows.forEach((row, index) => {
      const prefix = assetNumberPrefix(typeById.get(row.applianceTypeId)!.name);
      const group = perType.get(prefix) ?? { prefix, rows: [] };
      group.rows.push(index);
      perType.set(prefix, group);
    });
    const assetNumbers = new Array<string>(n.rows.length);
    for (const group of perType.values()) {
      const numbers = await allocateAssetNumbers(tx, group.prefix, group.rows.length);
      group.rows.forEach((rowIndex, i) => { assetNumbers[rowIndex] = numbers[i]!; });
    }

    const created: { id: string; assetNumber: string }[] = [];
    for (const [index, row] of n.rows.entries()) {
      const appliance = await tx.appliance.create({
        data: {
          assetNumber: assetNumbers[index]!, applianceTypeId: row.applianceTypeId, purchaseId: purchase.id,
          manufacturer: row.manufacturer, model: row.model, serialNumber: row.serialNumber,
          color: row.color, condition: row.condition, features: [],
          purchaseDate: n.purchasedOn, acquisitionCostCents: row.priceCents,
        },
        select: { id: true, assetNumber: true },
      });
      created.push(appliance);
      await tx.auditLog.create({
        data: {
          userId: actorId, action: "appliance.unit.create", entityType: "Appliance", entityId: appliance.id,
          newValue: { assetNumber: appliance.assetNumber, applianceTypeId: row.applianceTypeId, purchaseId: purchase.id },
        },
      });
    }

    for (const [index, doc] of n.documents.entries()) {
      const photo = await tx.photo.create({
        data: { url: doc.url, altText: doc.altText ?? "Purchase receipt" }, select: { id: true },
      });
      await tx.purchaseDocument.create({
        data: { purchaseId: purchase.id, photoId: photo.id, kind: doc.kind, pageOrder: index + 1 },
      });
    }

    for (const [index, appliance] of created.entries()) {
      await recordApplianceAcquisitionTaxInTx(tx, actorId, {
        applianceId: appliance.id, expectedRecordedAt: null,
        ...applianceTaxInput(n.taxAnswer, n.math.taxShares[index]!, n.otherState, n.sellerTaxCents),
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId, action: "purchase.record", entityType: "Purchase", entityId: purchase.id,
        newValue: {
          supplierId: n.supplierId, sellerName: n.sellerName, purchasedOn: businessDateKey(n.purchasedOn),
          appliances: created.length, subtotalCents: n.math.subtotalCents, sellerTaxCents: n.sellerTaxCents,
          sellerTaxKind: kind, otherChargesCents: n.otherChargesCents, documents: n.documents.length,
        },
      },
    });
    return readRecorded(tx, purchase.id, false, now);
  }, { timeout: 30_000, maxWait: 10_000 });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listPurchases(options: { supplierId?: string; take?: number; skip?: number } = {}) {
  return prisma.purchase.findMany({
    where: options.supplierId ? { supplierId: options.supplierId } : undefined,
    orderBy: [{ purchasedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: Math.min(options.take ?? 50, 200), skip: options.skip ?? 0,
    include: {
      supplier: { select: { id: true, name: true } },
      _count: { select: { appliances: true, documents: true } },
    },
  });
}

export async function countPurchases(options: { supplierId?: string } = {}) {
  return prisma.purchase.count({ where: options.supplierId ? { supplierId: options.supplierId } : undefined });
}

export type PurchaseDetail = NonNullable<Awaited<ReturnType<typeof getPurchaseDetail>>>;

/** One purchase with its appliances, receipt pages, split and shared next steps. */
export async function getPurchaseDetail(id: string, now = new Date()) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      documents: { orderBy: [{ pageOrder: "asc" }], select: { id: true, kind: true, pageOrder: true, photoId: true } },
      appliances: {
        orderBy: [{ createdAt: "asc" }, { assetNumber: "asc" }],
        select: {
          id: true, assetNumber: true, manufacturer: true, model: true, serialNumber: true, condition: true,
          color: true, acquisitionCostCents: true, acquisitionTaxStatus: true, acquisitionTaxPaidCents: true,
          applianceType: { select: { name: true } },
        },
      },
    },
  });
  if (!purchase) return null;
  const prices = purchase.appliances.map((a) => a.acquisitionCostCents ?? 0);
  const split = splitSellerTax(prices, purchase.sellerTaxCents);
  const steps = await loadApplianceTaxSteps(prisma, purchase.appliances.map((a) => a.id), now);
  const currentSubtotal = prices.reduce((sum, price) => sum + price, 0);
  return {
    ...purchase,
    taxBasis: split.basis,
    receiptTotalCents: purchase.subtotalCents + purchase.sellerTaxCents + purchase.otherChargesCents,
    // False if someone later corrected a price on an appliance page; the page says so.
    pricesStillMatchReceipt: currentSubtotal === purchase.subtotalCents,
    appliances: purchase.appliances.map((a, i) => ({
      ...a, taxShareCents: split.shares[i] ?? 0,
      step: steps.get(a.id)! as PurchaseTaxStep,
    })),
  };
}

// ---------------------------------------------------------------------------
// Changing a purchase after it was saved
// ---------------------------------------------------------------------------

export type UpdatePurchaseTaxInput = {
  purchaseId: string;
  /** The `taxRevisionAt` shown on the page; a changed value means someone else saved first. */
  expectedTaxRevisionAt: Date;
  taxAnswer: PurchaseTaxAnswer;
  sellerTaxCents: number;
  otherState?: string | null;
};

/**
 * Re-answer the tax question for a whole purchase. The tax is split by the appliances' current prices,
 * each appliance goes through the same audited acquisition-tax write as before, and a purchase whose
 * tax was already reported on a FILED return keeps its filed rows: the corrected figures change the
 * live rows and the existing amendment detector raises "Correct your return" with the difference.
 */
export async function updatePurchaseTaxAnswer(actorId: string, input: UpdatePurchaseTaxInput, now = new Date()) {
  if (!PURCHASE_TAX_ANSWERS.includes(input.taxAnswer)) throw new Error("Answer the tax question.");
  const otherState = clean(input.otherState, 60, "State");
  const taxed = input.taxAnswer === "YES_COLORADO" || input.taxAnswer === "YES_OTHER_STATE";
  if (input.taxAnswer === "YES_OTHER_STATE" && !otherState) throw new Error("Type which state's tax was charged.");
  if (input.taxAnswer !== "YES_OTHER_STATE" && otherState) throw new Error("A state applies only to another state's tax.");
  if (taxed && input.sellerTaxCents <= 0) throw new Error("Enter the tax printed on the receipt.");
  if (!taxed && input.sellerTaxCents !== 0) throw new Error("Seller tax can only be entered when the seller charged tax.");

  return prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    if (actor.role !== "OWNER") throw new Error("Only the owner can change purchase-tax evidence.");
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Purchase" WHERE "id" = ${input.purchaseId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Purchase not found.");
    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: input.purchaseId },
      include: { appliances: { orderBy: [{ createdAt: "asc" }, { assetNumber: "asc" }],
        select: { id: true, acquisitionCostCents: true, acquisitionTaxRecordedAt: true } } },
    });
    if (purchase.taxRevisionAt.getTime() !== input.expectedTaxRevisionAt.getTime()) {
      throw new Error("Someone updated this purchase's tax. Reload before saving.");
    }
    const split = splitSellerTax(purchase.appliances.map((a) => a.acquisitionCostCents ?? 0), input.sellerTaxCents);
    for (const [index, appliance] of purchase.appliances.entries()) {
      await recordApplianceAcquisitionTaxInTx(tx, actorId, {
        applianceId: appliance.id, expectedRecordedAt: appliance.acquisitionTaxRecordedAt,
        ...applianceTaxInput(input.taxAnswer, split.shares[index]!, otherState, input.sellerTaxCents),
      });
    }
    const revision = new Date(Math.max(Date.now(), purchase.taxRevisionAt.getTime() + 1, now.getTime()));
    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        sellerTaxCents: input.sellerTaxCents, sellerTaxKind: kindFor(input.taxAnswer),
        sellerTaxState: otherState, taxRevisionAt: revision,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "purchase.tax_answer", entityType: "Purchase", entityId: purchase.id,
        oldValue: { sellerTaxKind: purchase.sellerTaxKind, sellerTaxCents: purchase.sellerTaxCents },
        newValue: { sellerTaxKind: kindFor(input.taxAnswer), sellerTaxCents: input.sellerTaxCents, state: otherState },
      },
    });
    return readRecorded(tx, purchase.id, false, now);
  }, { timeout: 30_000, maxWait: 10_000 });
}

export type UpdatePurchaseDetailsInput = {
  purchaseId: string;
  supplierId?: string | null;
  sellerName?: string | null;
  reference?: string | null;
  notes?: string | null;
};

/** Correct the words on a purchase (who, receipt number, notes). Money and tax have their own paths. */
export async function updatePurchaseDetails(actorId: string, input: UpdatePurchaseDetailsInput) {
  const supplierId = input.supplierId?.trim() || null;
  const sellerName = clean(input.sellerName, 200, "Seller name");
  if (!supplierId && !sellerName) throw new Error("Choose a supplier or type who you bought from.");
  if (supplierId && sellerName) throw new Error("Choose a supplier or type a private seller, not both.");
  const reference = clean(input.reference, 100, "Receipt number");
  const notes = clean(input.notes, 2000, "Notes");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Purchase" WHERE "id" = ${input.purchaseId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Purchase not found.");
    if (supplierId) {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { archivedAt: true } });
      if (!supplier) throw new Error("That supplier no longer exists.");
    }
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: input.purchaseId } });
    await tx.purchase.update({ where: { id: input.purchaseId }, data: { supplierId, sellerName, reference, notes } });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "purchase.details", entityType: "Purchase", entityId: input.purchaseId,
        oldValue: { supplierId: before.supplierId, sellerName: before.sellerName, reference: before.reference },
        newValue: { supplierId, sellerName, reference },
      },
    });
  });
}

/** Attach more receipt pages later (for example after "I'll check the receipt later"). */
export async function addPurchaseDocuments(actorId: string, purchaseId: string, documents: PurchaseDocumentInput[]) {
  if (!documents.length) throw new Error("Choose at least one receipt page.");
  const urls = documents.map((doc) => doc.url);
  if (new Set(urls).size !== urls.length) throw new Error("A receipt page was attached twice.");
  await verifyPurchaseUploads(purchaseId, urls);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Purchase" WHERE "id" = ${purchaseId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Purchase not found.");
    const count = await tx.purchaseDocument.count({ where: { purchaseId } });
    if (count + documents.length > MAX_PURCHASE_DOCUMENTS) {
      throw new Error(`A purchase can hold up to ${MAX_PURCHASE_DOCUMENTS} receipt pages.`);
    }
    const last = await tx.purchaseDocument.aggregate({ where: { purchaseId }, _max: { pageOrder: true } });
    let order = last._max.pageOrder ?? 0;
    for (const doc of documents) {
      const photo = await tx.photo.create({
        data: { url: doc.url, altText: clean(doc.altText, 200, "Receipt description") ?? "Purchase receipt" },
        select: { id: true },
      });
      order += 1;
      await tx.purchaseDocument.create({
        data: { purchaseId, photoId: photo.id, kind: doc.kind ?? "RECEIPT", pageOrder: order },
      });
    }
    await tx.auditLog.create({
      data: { userId: actorId, action: "purchase.documents_add", entityType: "Purchase", entityId: purchaseId,
        newValue: { added: documents.length } },
    });
  });
}

// ---------------------------------------------------------------------------
// Removing a receipt page (W-15 protection)
// ---------------------------------------------------------------------------

/**
 * A receipt page may be removed (for example, the wrong photo was attached) only when no filed return
 * relies on this purchase and, if it is the last page, the purchase is already past the owner's record-keeping
 * period. The database also refuses to delete a receipt photo that a purchase still points to.
 */
export async function removePurchaseDocument(actorId: string, documentId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const doc = await tx.purchaseDocument.findUnique({
      where: { id: documentId },
      select: { id: true, purchaseId: true, photoId: true, purchase: { select: { purchasedOn: true, appliances: { select: { id: true } } } } },
    });
    if (!doc) throw new Error("That receipt page was already removed.");
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Purchase" WHERE "id" = ${doc.purchaseId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Purchase not found.");
    const filed = await tx.purchaseUseTax.count({
      where: { sourceType: "APPLIANCE", sourceId: { in: doc.purchase.appliances.map((a) => a.id) }, status: "FILED" },
    });
    if (filed > 0) {
      throw new Error("A filed tax return relies on this purchase, so its receipt cannot be removed.");
    }
    const remaining = await tx.purchaseDocument.count({ where: { purchaseId: doc.purchaseId } });
    if (remaining <= 1) {
      const settings = await tx.businessSettings.findUnique({ where: { id: "singleton" }, select: { recordRetentionYears: true } });
      const years = settings?.recordRetentionYears ?? 7;
      const keepUntil = new Date(doc.purchase.purchasedOn);
      keepUntil.setUTCFullYear(keepUntil.getUTCFullYear() + years);
      if (keepUntil.getTime() > now.getTime()) {
        throw new Error(`This is the only receipt page, and records are kept ${years} ${years === 1 ? "year" : "years"} (until ${businessDateKey(keepUntil)}).`);
      }
    }
    const receiptPhoto = await tx.photo.findUnique({ where: { id: doc.photoId }, select: { url: true } });
    await tx.purchaseDocument.delete({ where: { id: doc.id } });
    await tx.photo.delete({ where: { id: doc.photoId } });
    // The stored file is deleted by the nightly clean-up after a waiting period, once nothing points at it.
    if (receiptPhoto) await queueStoredFileCleanup(tx, { url: receiptPhoto.url, reason: "receipt page removed", kind: "receipt", now });
    await tx.auditLog.create({
      data: { userId: actorId, action: "purchase.document_remove", entityType: "Purchase", entityId: doc.purchaseId, oldValue: { photoId: doc.photoId } },
    });
  });
}
