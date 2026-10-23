import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { applySaleInvoiceTaxInTx } from "@/domains/tax/local-invoice";
import { applyPartMovementsInTx, lockPartRecords, OPERATION_KEY_PATTERN, PartOperationConflictError } from "@/domains/purchasing/ledger";
import { ensureWalkInCustomer } from "./walk-in";

// ---------------------------------------------------------------------------
// Shop sales (Batch M, design D-M3). A sale is a local invoice: lines are sellable parts (plus an optional delivery or
// installation charge), the tax is figured by where the goods go (the shop's tax areas for a pickup, the customer's
// address for a delivery), and each item line takes its units out of stock in the same transaction. If anything is
// missing (tax setup, stock, a price) the whole sale is refused and nothing is saved. Money is taken afterwards with
// the existing manual-payment action.
// ---------------------------------------------------------------------------

export type ShopSaleItem = {
  partRecordId: string;
  quantity: number;
  unitPriceCents: number;
  /** Required when the price is lower than the price set on the Parts screen. */
  priceReason?: string;
};

export type ShopSaleInput = {
  /** A retry with the same key returns the first sale and changes nothing. */
  operationKey: string;
  /** null = a walk-in with no account. */
  customerId: string | null;
  walkInName?: string;
  location: "PICKUP" | "DELIVERED";
  /** DELIVERED only: one of the customer's saved addresses. */
  serviceAddressId?: string | null;
  items: ShopSaleItem[];
  deliveryChargeCents?: number;
  installationChargeCents?: number;
  note?: string;
};

export type ShopSaleResult = {
  invoiceId: string;
  invoiceNumber: number;
  customerId: string;
  subtotalCents: number;
  taxCents: number;
  amountDueCents: number;
  replayed: boolean;
};

const MAX_ITEMS = 40;
const MAX_QUANTITY = 1000;
const MAX_UNIT_PRICE_CENTS = 100_000_00;

function cleanText(value: string | undefined, max: number): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}

export function saleDescription(part: { modelNumber: string; partNumber: string; partName: string | null }, quantity: number, unitPriceCents: number): string {
  const name = part.partName?.trim() || `Part ${part.partNumber}`;
  const label = `${name} (${part.modelNumber})`;
  return quantity === 1 ? label : `${label} — ${quantity} × ${formatMoney(unitPriceCents)}`;
}

function validate(input: ShopSaleInput): void {
  if (!OPERATION_KEY_PATTERN.test(input.operationKey)) throw new Error("This request has no valid identity. Reload the page and try again.");
  if (input.location !== "PICKUP" && input.location !== "DELIVERED") throw new Error("Choose pickup or delivery.");
  if (input.items.length < 1) throw new Error("Add at least one item to sell.");
  if (input.items.length > MAX_ITEMS) throw new Error(`A sale can have up to ${MAX_ITEMS} different items. Split it into two sales.`);
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.partRecordId)) throw new Error("Each item can be on a sale once. Change its quantity instead of adding it again.");
    seen.add(item.partRecordId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) throw new Error(`Enter a quantity from 1 to ${MAX_QUANTITY}.`);
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || item.unitPriceCents > MAX_UNIT_PRICE_CENTS) throw new Error("Enter a price between $0 and $100,000.");
  }
  for (const charge of [input.deliveryChargeCents, input.installationChargeCents]) {
    if (charge !== undefined && (!Number.isSafeInteger(charge) || charge < 0 || charge > MAX_UNIT_PRICE_CENTS)) throw new Error("A delivery or installation charge must be between $0 and $100,000.");
  }
  if (input.location === "PICKUP" && ((input.deliveryChargeCents ?? 0) > 0 || (input.installationChargeCents ?? 0) > 0)) {
    throw new Error("A pickup sale has no delivery or installation charge. Choose “Delivered” or remove the charge.");
  }
}

function payloadHash(input: ShopSaleInput): string {
  const items = [...input.items]
    .sort((a, b) => (a.partRecordId < b.partRecordId ? -1 : 1))
    .map((i) => [i.partRecordId, i.quantity, i.unitPriceCents, cleanText(i.priceReason, 200)]);
  return createHash("sha256")
    .update(JSON.stringify([input.customerId, cleanText(input.walkInName, 80), input.location, input.serviceAddressId ?? null, items, input.deliveryChargeCents ?? 0, input.installationChargeCents ?? 0, cleanText(input.note, 300)]))
    .digest("hex");
}

export async function createShopSale(actorUserId: string, input: ShopSaleInput, now = new Date()): Promise<ShopSaleResult> {
  validate(input);
  const hash = payloadHash(input);

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);

    // A retry (lost response, double tap) returns the first sale and changes nothing.
    const replay = await replayedSale(tx, input.operationKey, hash);
    if (replay) return replay;

    let customerId: string;
    let walkIn = false;
    if (input.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, isWalkIn: false, archivedAt: null }, select: { id: true } });
      if (!customer) throw new Error("Couldn't find that customer. Choose them again or ring this up as a walk-in.");
      customerId = customer.id;
    } else {
      if (input.location === "DELIVERED") throw new Error("A delivered sale needs a customer with an address. Add the customer first, then ring up the sale.");
      customerId = (await ensureWalkInCustomer(tx)).customerId;
      walkIn = true;
    }

    let serviceAddressId: string | null = null;
    if (input.location === "DELIVERED") {
      if (!input.serviceAddressId) throw new Error("Choose the address it is going to.");
      const address = await tx.serviceAddress.findFirst({ where: { id: input.serviceAddressId, customerId }, select: { id: true } });
      if (!address) throw new Error("That address doesn't belong to this customer.");
      serviceAddressId = address.id;
    }

    // Lock order: the customer's ledger, then the parts sorted by id (as everywhere else).
    await lockCustomerLedger(tx, customerId);
    await lockPartRecords(tx, input.items.map((i) => i.partRecordId));
    const parts = await tx.partRecord.findMany({
      where: { id: { in: input.items.map((i) => i.partRecordId) } },
      select: { id: true, modelNumber: true, partNumber: true, partName: true, sellable: true, retailPriceCents: true, archivedAt: true, quantityOnHand: true },
    });
    const partById = new Map(parts.map((p) => [p.id, p]));

    const lines: Array<{ item: ShopSaleItem; part: (typeof parts)[number]; total: number }> = [];
    for (const item of input.items) {
      const part = partById.get(item.partRecordId);
      if (!part) throw new Error("One of those items no longer exists. Reload the page.");
      const label = part.partName?.trim() || `Part ${part.partNumber}`;
      if (part.archivedAt) throw new Error(`“${label}” is archived. Restore it on the Parts screen before selling it.`);
      if (!part.sellable) throw new Error(`“${label}” isn't marked “Sell to customers” on the Parts screen.`);
      if (part.retailPriceCents !== null && item.unitPriceCents < part.retailPriceCents && !cleanText(item.priceReason, 200)) {
        throw new Error(`“${label}” is listed at ${formatMoney(part.retailPriceCents)}. Say why it is being sold for less.`);
      }
      if (item.quantity > part.quantityOnHand) throw new Error(`Only ${part.quantityOnHand} of “${label}” on hand. Recount on the Parts screen if the shelf count is wrong.`);
      lines.push({ item, part, total: item.quantity * item.unitPriceCents });
    }

    const delivery = input.deliveryChargeCents ?? 0;
    const installation = input.installationChargeCents ?? 0;
    const subtotalCents = lines.reduce((sum, l) => sum + l.total, 0) + delivery + installation;
    if (subtotalCents <= 0) throw new Error("The sale total is $0. Enter a price for at least one item.");

    const invoice = await tx.invoice.create({
      data: {
        customerId,
        status: "DRAFT",
        subtotalCents,
        taxCents: 0,
        amountDueCents: subtotalCents,
        dueDate: now,
        issuedAt: now,
        saleKind: "SHOP_SALE",
        saleLocation: input.location,
        saleServiceAddressId: serviceAddressId,
        walkInName: walkIn ? cleanText(input.walkInName, 80) : null,
        saleOperationKey: input.operationKey,
      },
    });

    const lineIds = new Map<string, string>();
    for (const { item, part, total } of lines) {
      const created = await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          kind: "MERCHANDISE",
          description: saleDescription(part, item.quantity, item.unitPriceCents),
          amountCents: total,
          quantity: item.quantity,
          partRecordId: part.id,
        },
        select: { id: true },
      });
      lineIds.set(part.id, created.id);
    }
    if (delivery > 0) {
      await tx.invoiceLineItem.create({ data: { invoiceId: invoice.id, kind: "DELIVERY_FEE", description: "Delivery", amountCents: delivery, quantity: 1 } });
    }
    if (installation > 0) {
      await tx.invoiceLineItem.create({ data: { invoiceId: invoice.id, kind: "INSTALLATION_FEE", description: "Installation", amountCents: installation, quantity: 1 } });
    }

    const tax = await applySaleInvoiceTaxInTx(tx, {
      invoiceId: invoice.id, customerId, serviceAddressId, taxDate: now, actorUserId,
    });
    if (!tax.ok) {
      // Nothing is saved: the whole transaction rolls back and the owner gets the plain reasons.
      throw new SaleTaxBlockedError(tax.problems);
    }

    for (const { item, part } of lines) {
      await applyPartMovementsInTx(tx, actorUserId, `${input.operationKey}:${part.id}`, [
        {
          partRecordId: part.id, kind: "SALE", quantityDelta: -item.quantity, unitCostCents: null,
          invoiceLineId: lineIds.get(part.id)!, reason: `Sold on invoice ${invoice.invoiceNumber}`,
        },
      ]);
    }

    const completed = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { invoiceNumber: true, taxCents: true, amountDueCents: true } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "sale.create",
        entityType: "Invoice",
        entityId: invoice.id,
        newValue: {
          operationKey: input.operationKey, payloadHash: hash, walkIn, location: input.location,
          itemCount: lines.length, subtotalCents, taxCents: completed.taxCents, saleOn: businessDateKey(now),
          loweredPrices: lines.filter((l) => l.part.retailPriceCents !== null && l.item.unitPriceCents < l.part.retailPriceCents).map((l) => ({ partRecordId: l.part.id, reason: cleanText(l.item.priceReason, 200) })),
          note: cleanText(input.note, 300),
        },
      },
    });

    return {
      invoiceId: invoice.id, invoiceNumber: completed.invoiceNumber, customerId,
      subtotalCents, taxCents: completed.taxCents, amountDueCents: completed.amountDueCents, replayed: false,
    };
  });
}

export type CancelShopSaleResult = { invoiceId: string; invoiceNumber: number; restocked: number; alreadyCancelled: boolean };

/**
 * Cancels a sale that has not been paid: the invoice is voided (the books reverse it) and every item goes back on the
 * shelf with a reversal entry, so the stock history shows both the sale and the cancel. A sale with money on it is
 * refused here; that goes through a return and refund so the tax and the money are handled together.
 */
export async function cancelShopSale(actorUserId: string, invoiceId: string, reason: string): Promise<CancelShopSaleResult> {
  const why = cleanText(reason, 200);
  if (!why) throw new Error("Say why the sale is being cancelled.");
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const found = await tx.invoice.findFirst({ where: { id: invoiceId, saleKind: "SHOP_SALE" }, select: { id: true, customerId: true } });
    if (!found) throw new Error("Couldn't find that sale.");
    await lockCustomerLedger(tx, found.customerId);
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${found.id} FOR UPDATE`;
    const sale = await tx.invoice.findUniqueOrThrow({
      where: { id: found.id },
      select: { id: true, invoiceNumber: true, status: true, amountPaidCents: true, lineItems: { select: { id: true } } },
    });
    if (sale.status === "VOID") return { invoiceId: sale.id, invoiceNumber: sale.invoiceNumber, restocked: 0, alreadyCancelled: true };
    if (sale.amountPaidCents > 0 || !["DRAFT", "OPEN"].includes(sale.status)) {
      throw new Error("This sale has been paid, so it can't just be cancelled. Take the item back with a return and refund instead.");
    }
    const sold = await tx.partStockMovement.findMany({
      where: { invoiceLineId: { in: sale.lineItems.map((l) => l.id) }, kind: "SALE" },
      select: { id: true, partRecordId: true, quantityDelta: true },
      orderBy: { id: "asc" },
    });
    await lockPartRecords(tx, sold.map((m) => m.partRecordId));
    for (const m of sold) {
      await applyPartMovementsInTx(tx, actorUserId, `cancel:${sale.id}:${m.id}`, [
        { partRecordId: m.partRecordId, kind: "REVERSAL", quantityDelta: 0, unitCostCents: null, reversesMovementId: m.id, reason: `Sale ${sale.invoiceNumber} cancelled: ${why}` },
      ]);
    }
    await tx.invoice.update({ where: { id: sale.id }, data: { status: "VOID", amountDueCents: 0 } });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "sale.cancel", entityType: "Invoice", entityId: sale.id, newValue: { reason: why, restockedLines: sold.length } },
    });
    return { invoiceId: sale.id, invoiceNumber: sale.invoiceNumber, restocked: sold.reduce((n, m) => n + -m.quantityDelta, 0), alreadyCancelled: false };
  });
}

export class SaleTaxBlockedError extends Error {
  constructor(readonly problems: string[]) {
    super(`This sale can't be completed yet. ${problems.join(" ")}`);
    this.name = "SaleTaxBlockedError";
  }
}

async function replayedSale(tx: Prisma.TransactionClient, operationKey: string, hash: string): Promise<ShopSaleResult | null> {
  const existing = await tx.invoice.findUnique({
    where: { saleOperationKey: operationKey },
    select: { id: true, invoiceNumber: true, customerId: true, subtotalCents: true, taxCents: true, amountDueCents: true },
  });
  if (!existing) return null;
  const audit = await tx.auditLog.findFirst({ where: { action: "sale.create", entityId: existing.id }, select: { newValue: true } });
  const was = audit?.newValue as { payloadHash?: string } | null;
  if (!was?.payloadHash || was.payloadHash !== hash) throw new PartOperationConflictError();
  return { invoiceId: existing.id, invoiceNumber: existing.invoiceNumber, customerId: existing.customerId, subtotalCents: existing.subtotalCents, taxCents: existing.taxCents, amountDueCents: existing.amountDueCents, replayed: true };
}

/** For the Sales list and the sale's own page. */
export const SALE_LIST_LIMIT = 100;

export async function listShopSales(actorUserId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN"]);
  return prisma.invoice.findMany({
    where: { saleKind: "SHOP_SALE" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SALE_LIST_LIMIT,
    select: {
      id: true, invoiceNumber: true, status: true, subtotalCents: true, taxCents: true, amountDueCents: true, amountPaidCents: true,
      createdAt: true, saleLocation: true, walkInName: true,
      customer: { select: { id: true, isWalkIn: true, user: { select: { name: true } } } },
      lineItems: { where: { kind: "MERCHANDISE" }, select: { description: true, quantity: true } },
    },
  });
}

export function saleBuyerLabel(sale: { walkInName: string | null; customer: { isWalkIn: boolean; user: { name: string | null } } }): string {
  if (sale.customer.isWalkIn) return sale.walkInName ? `Walk-in: ${sale.walkInName}` : "Walk-in";
  return sale.customer.user.name ?? "Customer";
}


export const SALE_FORM_CUSTOMER_LIMIT = 500;

/** What the new-sale screen needs: items that can be sold now, and the customers (with addresses) a sale can go to. */
export async function getSaleFormData(actorUserId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN"]);
  const [parts, customers] = await Promise.all([
    prisma.partRecord.findMany({
      where: { sellable: true, archivedAt: null, quantityOnHand: { gt: 0 } },
      orderBy: [{ partName: "asc" }, { modelNumber: "asc" }, { id: "asc" }],
      take: 1000,
      select: { id: true, modelNumber: true, partNumber: true, partName: true, quantityOnHand: true, retailPriceCents: true },
    }),
    prisma.customer.findMany({
      where: { archivedAt: null, isWalkIn: false },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
      take: SALE_FORM_CUSTOMER_LIMIT,
      select: {
        id: true,
        user: { select: { name: true, email: true } },
        serviceAddresses: { select: { id: true, line1: true, city: true, zip: true, unitLabel: true }, orderBy: { id: "asc" } },
      },
    }),
  ]);
  return { parts, customers };
}

/** One sale with its lines, tax breakdown and stock movements, for the sale page. */
export async function getShopSale(actorUserId: string, invoiceId: string) {
  await assertActiveTeamActor(prisma, actorUserId, ["OWNER", "ADMIN"]);
  return prisma.invoice.findFirst({
    where: { id: invoiceId, saleKind: "SHOP_SALE" },
    select: {
      id: true, invoiceNumber: true, status: true, subtotalCents: true, taxCents: true, amountDueCents: true, amountPaidCents: true,
      createdAt: true, saleLocation: true, walkInName: true, customerId: true,
      customer: { select: { id: true, isWalkIn: true, user: { select: { name: true, email: true } } } },
      lineItems: { orderBy: { id: "asc" }, select: { id: true, kind: true, description: true, amountCents: true, quantity: true } },
      taxLines: {
        orderBy: { id: "asc" },
        select: { id: true, taxableCents: true, exemptCents: true, taxCents: true, jurisdiction: { select: { name: true } } },
      },
    },
  });
}
