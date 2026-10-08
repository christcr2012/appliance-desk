import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { claimProviderOperation, completeProviderOperation, runProviderCall } from "@/domains/billing/provider-ops";
import { applyLocalInvoiceTaxInTx } from "./local-invoice";

type Tx = Prisma.TransactionClient;
export const RDF_LINE_DESCRIPTION = "Colorado retail delivery fee";
const SEND_AUDIT = "tax.rdf.provider_send_started";
const INTENT_AUDIT = "tax.rdf.provider_intent";

/**
 * Customer collection is deliberately opt-in, separately from the owner's
 * selection of fee handling. The legal/go-live approvals precede enabling
 * this environment flag; no default-on money changes are introduced here.
 */
export function rdfChargingEnabled(): boolean {
  return process.env.RDF_CUSTOMER_CHARGING_ENABLED === "true";
}

function fingerprint(recordId: string, subscriptionId: string, customerId: string, cents: number) {
  return createHash("sha256").update(JSON.stringify({
    version: 1, recordId, subscriptionId, customerId, cents,
    description: RDF_LINE_DESCRIPTION, currency: "usd", taxRates: [],
  })).digest("hex");
}

export type PreparedRdfCharge =
  | { kind: "NONE" }
  | { kind: "LOCAL"; invoiceId: string }
  | { kind: "PROVIDER"; operationId: string };

/**
 * Observe the immutable agreement id before taking locks. Lock the agreement
 * before the RDF row, matching delivery-completion's existing lock order;
 * otherwise a concurrent completion/recovery could deadlock against charging.
 * Call only after completion commits, never inside its existing transaction.
 */
export async function prepareRdfChargeInTx(
  tx: Tx,
  recordId: string,
): Promise<PreparedRdfCharge> {
  if (!rdfChargingEnabled()) return { kind: "NONE" };
  const identity = await tx.retailDeliveryFeeRecord.findUnique({
    where: { id: recordId }, select: { agreementId: true },
  });
  if (!identity) throw new Error("Retail delivery fee record not found.");
  if (!identity.agreementId) throw new Error("A rental delivery fee must belong to an agreement.");
  const agreementId = identity.agreementId;
  await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" = ${agreementId} FOR UPDATE`;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "RetailDeliveryFeeRecord" WHERE "id" = ${recordId} FOR UPDATE
  `;
  if (!locked.length) throw new Error("Retail delivery fee record disappeared.");
  const record = await tx.retailDeliveryFeeRecord.findUniqueOrThrow({
    where: { id: recordId },
    select: {
      id: true, status: true, agreementId: true, amountCents: true,
      collectedFromCustomer: true, invoiceLineId: true, deliveredOn: true,
    },
  });
  if (record.status !== "READY" || record.collectedFromCustomer !== true) return { kind: "NONE" };
  if (record.invoiceLineId) return { kind: "NONE" };
  const cents = record.amountCents;
  if (!Number.isSafeInteger(cents) || cents === null || cents <= 0) {
    throw new Error("A READY collected delivery fee must have a positive integer-cent rate.");
  }
  if (record.agreementId !== agreementId) {
    throw new Error("The RDF sale ownership changed during a locked charge.");
  }

  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      customerId: true, stripeSubscriptionId: true, paidInFullInAdvance: true,
      status: true, customer: { select: { stripeCustomerId: true } },
    },
  });

  const recurring = agreement.status === "ACTIVE" &&
    !agreement.paidInFullInAdvance && Boolean(agreement.stripeSubscriptionId);
  if (recurring) {
    const subscriptionId = agreement.stripeSubscriptionId!;
    const customerId = agreement.customer.stripeCustomerId;
    if (!customerId) throw new Error("Stripe subscription has no linked provider customer.");
    const hash = fingerprint(record.id, subscriptionId, customerId, cents);
    const key = `rdf-${record.id}`;
    const prior = await tx.providerOperation.findUnique({
      where: { idempotencyKey: key },
      select: { id: true, kind: true, subjectId: true },
    });
    if (prior) {
      if (prior.kind !== "RDF_INVOICE_ITEM" || prior.subjectId !== record.id)
        throw new Error("RDF provider key belongs to a different operation.");
      const intent = await tx.auditLog.findFirst({
        where: { entityType: "ProviderOperation", entityId: prior.id, action: INTENT_AUDIT },
        select: { newValue: true },
      });
      if ((intent?.newValue as { hash?: unknown } | null)?.hash !== hash)
        throw new Error("RDF provider payload changed after its immutable intent was recorded.");
      return { kind: "PROVIDER", operationId: prior.id };
    }
    const claim = await claimProviderOperation(tx, {
      kind: "RDF_INVOICE_ITEM", subjectType: "RetailDeliveryFeeRecord",
      subjectId: record.id, idempotencyKey: key,
    });
    if (claim.done) throw new Error("Unrecognized already-complete RDF intent.");
    await tx.auditLog.create({
      data: {
        action: INTENT_AUDIT, entityType: "ProviderOperation",
        entityId: claim.opId,
        newValue: { hash, recordId: record.id, subscriptionId, customerId, cents },
      },
    });
    return { kind: "PROVIDER", operationId: claim.opId };
  }

  // Only unissued, unpaid local drafts may be edited. OPEN, paid, finalized
  // and provider-mirrored invoices are immutable even when still outstanding.
  const draft = await tx.invoice.findFirst({
    where: {
      agreementId, status: "DRAFT", stripeInvoiceId: null, issuedAt: null,
      amountPaidCents: 0,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const now = new Date();
  let invoiceId: string;
  let lineId: string;
  if (draft) {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${draft.id} FOR UPDATE`;
    const line = await tx.invoiceLineItem.create({
      data: { invoiceId: draft.id, kind: "RETAIL_DELIVERY_FEE",
        description: RDF_LINE_DESCRIPTION, amountCents: cents },
      select: { id: true },
    });
    await tx.invoice.update({
      where: { id: draft.id },
      data: { subtotalCents: { increment: cents }, amountDueCents: { increment: cents },
        version: { increment: 1 } },
    });
    await applyLocalInvoiceTaxInTx(tx, {
      invoiceId: draft.id, agreementId, taxDate: record.deliveredOn, actorUserId: null,
    });
    invoiceId = draft.id;
    lineId = line.id;
  } else {
    // No future subscription or mutable draft: charge via a separate
    // manual-payment-only invoice, due upon receipt, never silently discard.
    const invoice = await tx.invoice.create({
      data: {
        agreementId, customerId: agreement.customerId, status: "OPEN",
        subtotalCents: cents, amountDueCents: cents, amountPaidCents: 0,
        taxCents: 0, discountCents: 0, dueDate: now, issuedAt: now,
        lineItems: {
          create: { kind: "RETAIL_DELIVERY_FEE", description: RDF_LINE_DESCRIPTION, amountCents: cents },
        },
      },
      select: { id: true, lineItems: { select: { id: true } } },
    });
    invoiceId = invoice.id;
    lineId = invoice.lineItems[0]!.id;
  }
  await tx.retailDeliveryFeeRecord.update({
    where: { id: record.id }, data: { invoiceLineId: lineId },
  });
  await tx.auditLog.create({
    data: {
      action: "tax.rdf.local_charge", entityType: "RetailDeliveryFeeRecord",
      entityId: record.id, newValue: { invoiceId, lineId, cents },
    },
  });
  return { kind: "LOCAL", invoiceId };
}

/** One process may send; a crash/timeout after send requires inspection. */
export async function dispatchRdfCharge(operationId: string): Promise<void> {
  if (!rdfChargingEnabled()) return;
  const intent = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{
      id: string; status: string; kind: string; subjectId: string; idempotencyKey: string;
    }>>`SELECT "id", "status", "kind", "subjectId", "idempotencyKey"
        FROM "ProviderOperation" WHERE "id" = ${operationId} FOR UPDATE`;
    const op = rows[0];
    if (!op || op.kind !== "RDF_INVOICE_ITEM") throw new Error("Invalid RDF provider operation.");
    if (op.status !== "PENDING") return null;
    const sent = await tx.auditLog.findFirst({
      where: { action: SEND_AUDIT, entityType: "ProviderOperation", entityId: operationId },
      select: { id: true },
    });
    if (sent) return null;
    const evidence = await tx.auditLog.findFirst({
      where: { action: INTENT_AUDIT, entityType: "ProviderOperation", entityId: operationId },
      select: { newValue: true },
    });
    const payload = evidence?.newValue as { hash?: string; recordId?: string; subscriptionId?: string; customerId?: string; cents?: number } | null;
    if (!payload?.recordId || !payload.subscriptionId || !payload.customerId ||
        !payload.cents || !payload.hash || payload.recordId !== op.subjectId ||
        payload.hash !== fingerprint(payload.recordId, payload.subscriptionId, payload.customerId, payload.cents))
      throw new Error("RDF provider intent has invalid or missing immutable payload.");
    const record = await tx.retailDeliveryFeeRecord.findUniqueOrThrow({
      where: { id: payload.recordId },
      select: { status: true, amountCents: true, collectedFromCustomer: true, invoiceLineId: true },
    });
    if (record.status !== "READY" || !record.collectedFromCustomer ||
        record.amountCents !== payload.cents || record.invoiceLineId)
      return null;
    await tx.auditLog.create({
      data: { action: SEND_AUDIT, entityType: "ProviderOperation", entityId: operationId,
        newValue: { hash: payload.hash, idempotencyKey: op.idempotencyKey } },
    });
    return { ...payload, key: op.idempotencyKey };
  });
  if (!intent) return;
  const result = await runProviderCall(() => getStripeClient().invoiceItems.create({
    customer: intent.customerId!,
    subscription: intent.subscriptionId!,
    amount: intent.cents!,
    currency: "usd",
    quantity: 1,
    description: RDF_LINE_DESCRIPTION,
    tax_rates: [],
    metadata: { rdf_record_id: intent.recordId!, rdf_payload_hash: intent.hash! },
  }, { idempotencyKey: intent.key }));
  await prisma.$transaction(async tx => {
    if (result.ok) {
      await completeProviderOperation(tx, operationId, {
        status: "SUCCEEDED", providerObjectId: result.value.id,
      });
    } else {
      await completeProviderOperation(tx, operationId, {
        status: result.outcome, error: result.error,
      });
    }
  });
}

/** Recovery uses a bounded batch and does not repeat an unknown Stripe write. */
export async function processReadyRdfCharges(limit = 30): Promise<{
  local: number; provider: number; blocked: number;
}> {
  if (!rdfChargingEnabled()) return { local: 0, provider: 0, blocked: 0 };
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid RDF charge limit.");
  const ready = await prisma.retailDeliveryFeeRecord.findMany({
    where: { status: "READY", collectedFromCustomer: true, invoiceLineId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  let local = 0, provider = 0, blocked = 0;
  for (const record of ready) {
    try {
      const prepared = await prisma.$transaction(tx => prepareRdfChargeInTx(tx, record.id));
      if (prepared.kind === "LOCAL") local++;
      if (prepared.kind === "PROVIDER") {
        await dispatchRdfCharge(prepared.operationId);
        provider++;
      }
    } catch (error) {
      blocked++;
      console.error("[rdf-charge] charge is awaiting operator inspection:",
        error instanceof Error ? error.message : "unknown error");
    }
  }
  return { local, provider, blocked };
}

