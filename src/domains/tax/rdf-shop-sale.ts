import type { Prisma, RdfRecordStatus } from "@prisma/client";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { getSaleTaxContext } from "./locations";
import { resolveTaxability } from "./engine";
import { retailDeliveryFeeStatus } from "./retail-delivery-fee";
import { recordedRetailSales } from "./rdf-sales-evidence";
import { RDF_LINE_DESCRIPTION, rdfChargingEnabled } from "./rdf-charges";
import { rdfBillingHeldBySwitch } from "./rdf-switches";
import { ruleAsOf, RuleMissingError } from "@/domains/rules/reads";

type Tx = Prisma.TransactionClient;

export type ShopSaleFeeResult = {
  recordId: string | null;
  status: RdfRecordStatus | null;
  /** Cents added to the invoice as the separate customer line (0 when none). */
  chargedCents: number;
};

type Decision = {
  status: RdfRecordStatus;
  reason: string;
  ruleVersionId: string | null;
  amountCents: number | null;
  collect: boolean;
};

const none = (reason: string): Decision => ({ status: "NOT_DUE", reason, ruleVersionId: null, amountCents: null, collect: false });
const pending = (reason: string, status: RdfRecordStatus = "PENDING_DECISION"): Decision => ({ status, reason, ruleVersionId: null, amountCents: null, collect: false });

function coDate(input: Date): Date {
  const date = businessDateFromKey(businessDateKey(input));
  if (!date) throw new Error("Invalid Colorado business date.");
  return date;
}

/**
 * Colorado's retail delivery fee for ONE delivered shop sale (design BATCH-T 12.4, goods rules).
 * Only a delivery to a Colorado address that holds at least one item of goods taxed by the STATE counts, and only once per
 * sale. Goods never depend on the rental lease election. Anything the app cannot decide yet is kept as a pending record
 * so nothing owed is lost; it never stops the sale.
 */
async function decide(tx: Tx, input: { invoiceId: string; customerId: string; serviceAddressId: string; saleOn: Date; saleInstant: Date }): Promise<Decision> {
  // TFA-2 §6.6: an exchange is one purchase. A replacement sale never gets a
  // second fee, whatever the replacement's own delivery looks like.
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId }, select: { replacementOfInvoiceId: true },
  });
  if (invoice.replacementOfInvoiceId)
    return none("This sale replaces another sale, so no new delivery fee is due.");
  const address = await tx.serviceAddress.findUniqueOrThrow({ where: { id: input.serviceAddressId }, select: { state: true } });
  if (address.state !== "CO") return none("Delivery address is outside Colorado.");
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { shortTermLeaseElection: true, rdfThresholdCrossedOn: true, rdfHandling: true, rdfCpaConfirmedOn: true },
  });
  if (!settings) return pending("Complete the business settings before deciding delivery fees.");
  // Exemption certificates are checked at the real moment of the sale (like the sale tax itself); the date-only value picks the rate and filing.
  const context = await getSaleTaxContext(tx, { customerId: input.customerId, serviceAddressId: input.serviceAddressId, taxDate: input.saleInstant });
  const stateRows = await tx.taxJurisdiction.findMany({ where: { id: { in: context.jurisdictions.map((j) => j.id) }, level: "STATE" }, select: { id: true } });
  if (stateRows.length !== 1) return pending("Confirm the Colorado state tax jurisdiction for this address.");
  const stateId = stateRows[0]!.id;
  const state = context.jurisdictions.find((j) => j.id === stateId)!;
  if (context.exemptJurisdictionIds.has(stateId)) return none("The customer has a state exemption certificate.");

  const goods = await tx.invoiceLineItem.findMany({ where: { invoiceId: input.invoiceId, kind: { in: ["MERCHANDISE", "USED_APPLIANCE"] } }, select: { kind: true } });
  let undecided: string | null = null;
  let taxable = false;
  for (const line of goods) {
    const category = line.kind === "MERCHANDISE" ? "MERCHANDISE" : "USED_APPLIANCE_SALE";
    const resolved = resolveTaxability(state, category, context);
    if (resolved.taxability === "TAXABLE") taxable = true;
    else if (resolved.taxability === "UNDECIDED") undecided = resolved.reason;
  }
  if (!taxable) return undecided ? pending(undecided) : none("Nothing on this sale is taxed by the state, so no delivery fee is due.");

  const year = Number(businessDateKey(input.saleOn).slice(0, 4));
  // TFA-1: the small-seller limit is a dated rule, not a setting.
  const thresholdCents = (await ruleAsOf<number>("co.rdf.qualified_threshold", input.saleOn, tx)).value;
  const [previous, current] = await Promise.all([
    recordedRetailSales(tx, year - 1),
    recordedRetailSales(tx, year),
  ]);
  const applicability = retailDeliveryFeeStatus({
    today: input.saleOn, saleType: "GOODS", election: settings.shortTermLeaseElection,
    previousYearRetailCents: previous, currentYearRetailCents: current, thresholdCents,
    thresholdCrossedOn: settings.rdfThresholdCrossedOn,
    handling: settings.rdfHandling, cpaConfirmedOn: settings.rdfCpaConfirmedOn,
  });
  if (applicability.status === "UNDECIDED") return pending(applicability.reason);
  if (applicability.status !== "APPLIES") return none(applicability.reason);

  // TFA-1: the fee amount is the dated rule in force on the sale date.
  let rate: { value: number; version: { id: string } } | null = null;
  try {
    rate = await ruleAsOf<number>("co.rdf.amount", input.saleOn, tx);
  } catch (error) {
    if (!(error instanceof RuleMissingError)) throw error;
  }
  if (!rate) return pending("Enter the delivery fee rate effective on the sale date.", "PENDING_RATE");
  return { status: "READY", reason: applicability.reason, ruleVersionId: rate.version.id, amountCents: rate.value, collect: settings.rdfHandling === "COLLECT_FROM_CUSTOMER" };
}

/**
 * Called inside the sale's transaction, after the lines exist and before tax is figured. Writes (or finishes) the one
 * record for this sale and, when the customer pays it and charging is switched on, adds the separate untaxed line.
 * `allowCustomerLine` is false when a pending record is finished later: the customer already left, so the business pays it.
 */
export async function recordShopSaleDeliveryFeeInTx(
  tx: Tx,
  input: { invoiceId: string; customerId: string; serviceAddressId: string | null; /** The real moment of the sale. */ saleOn: Date; allowCustomerLine: boolean },
): Promise<ShopSaleFeeResult> {
  if (!input.serviceAddressId) return { recordId: null, status: null, chargedCents: 0 };
  const saleKey = "retail:" + input.invoiceId;
  const prior = await tx.retailDeliveryFeeRecord.findUnique({ where: { saleKey } });
  if (prior && (prior.status === "READY" || prior.status === "NOT_DUE")) return { recordId: prior.id, status: prior.status, chargedCents: 0 };
  const saleOn = prior?.deliveredOn ?? coDate(input.saleOn);
  const decision = await decide(tx, { invoiceId: input.invoiceId, customerId: input.customerId, serviceAddressId: input.serviceAddressId, saleOn, saleInstant: input.saleOn });
  // TFA-2 §6.3: an unapproved START switch holds the customer line (the fee is
  // owed and reported; the business carries it for this sale).
  const held = decision.status === "READY" ? await rdfBillingHeldBySwitch(tx, input.saleOn) : false;
  const customerLine = decision.status === "READY" && decision.collect && input.allowCustomerLine && rdfChargingEnabled() && (decision.amountCents ?? 0) > 0 && !held;
  const data = {
    status: decision.status, ruleVersionId: decision.ruleVersionId, rateId: null, saleOn: decision.status === "READY" ? saleOn : null,
    amountCents: decision.amountCents,
    // Collected only when a customer line really goes on this invoice; otherwise the business pays it (still reported).
    collectedFromCustomer: decision.status === "READY" ? customerLine : null,
  };
  const row = await tx.retailDeliveryFeeRecord.upsert({
    where: { saleKey },
    create: { saleKey, invoiceId: input.invoiceId, deliveredOn: saleOn, ...data },
    update: data,
  });
  let chargedCents = 0;
  if (customerLine) {
    chargedCents = decision.amountCents!;
    const line = await tx.invoiceLineItem.create({
      data: { invoiceId: input.invoiceId, kind: "RETAIL_DELIVERY_FEE", description: RDF_LINE_DESCRIPTION, amountCents: chargedCents, quantity: 1 },
      select: { id: true },
    });
    await tx.retailDeliveryFeeRecord.update({ where: { id: row.id }, data: { invoiceLineId: line.id } });
    await tx.invoice.update({ where: { id: input.invoiceId }, data: { subtotalCents: { increment: chargedCents }, amountDueCents: { increment: chargedCents } } });
  }
  if (!prior || prior.status !== row.status) {
    await tx.auditLog.create({
      data: {
        action: "tax.rdf.record", entityType: "RetailDeliveryFeeRecord", entityId: row.id,
        newValue: { saleKey, status: row.status, reason: decision.reason, amountCents: row.amountCents, chargedToCustomer: customerLine, heldForApproval: held },
      },
    });
  }
  return { recordId: row.id, status: row.status, chargedCents };
}

/**
 * TFA-2 §6.5: on a return after delivery the delivery fee is still owed, so the
 * part of what the customer paid that IS the fee is kept, not refunded. Returns
 * the cents to keep (0 unless the fee was decided due and the customer paid it
 * as its own line).
 */
export async function shopSaleFeeKeptOnReturnInTx(tx: Tx, invoiceId: string): Promise<number> {
  const record = await tx.retailDeliveryFeeRecord.findUnique({
    where: { saleKey: "retail:" + invoiceId },
    select: { status: true, amountCents: true, collectedFromCustomer: true, invoiceLineId: true },
  });
  if (!record || record.status !== "READY" || record.collectedFromCustomer !== true || !record.invoiceLineId)
    return 0;
  return record.amountCents ?? 0;
}

/**
 * A shop sale was cancelled before delivery (never paid): its fee is no longer
 * due (design BATCH-T 12.5). A fee the customer paid is marked refunded with
 * the real refund record, which is what lets a fee already reported to
 * Colorado be claimed back as a credit; one never paid simply stops counting.
 * Returns after delivery do NOT come through here (TFA-2 §6.5): the fee stays
 * owed, so nothing is voided.
 */
export async function voidShopSaleDeliveryFeeInTx(
  tx: Tx,
  input: { invoiceId: string; refundId: string | null; at: Date; actorUserId: string },
): Promise<{ recordId: string | null; changed: boolean }> {
  const saleKey = "retail:" + input.invoiceId;
  const record = await tx.retailDeliveryFeeRecord.findUnique({ where: { saleKey } });
  if (!record) return { recordId: null, changed: false };
  if (record.status === "NOT_DUE") return { recordId: record.id, changed: false };
  const paidByCustomer = record.collectedFromCustomer === true && !!record.invoiceLineId;
  await tx.retailDeliveryFeeRecord.update({
    where: { id: record.id },
    data: {
      status: "NOT_DUE",
      ...(input.refundId && paidByCustomer ? { customerRefundedAt: input.at, customerRefundRef: input.refundId } : {}),
      ...(!input.refundId && paidByCustomer ? { collectedFromCustomer: false } : {}),
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.actorUserId, action: "tax.rdf.sale_reversed", entityType: "RetailDeliveryFeeRecord", entityId: record.id,
      newValue: { saleKey, refundId: input.refundId, hadFiledPeriod: !!record.filingPeriodId },
    },
  });
  return { recordId: record.id, changed: true };
}
