import { Prisma, type RdfRecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { getAgreementTaxContext } from "./locations";
import { resolveTaxability } from "./engine";
import { rdfRateForSale, retailDeliveryFeeStatus } from "./retail-delivery-fee";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";

type Tx = Prisma.TransactionClient;
type Result = { recordId: string | null; status: RdfRecordStatus | null };
type Decision = {
  status: RdfRecordStatus;
  reason: string;
  saleOn: Date | null;
  rateId: string | null;
  amountCents: number | null;
  collectedFromCustomer: boolean | null;
};

function coDate(input: Date): Date {
  const date = businessDateFromKey(businessDateKey(input));
  if (!date) throw new Error("Invalid Colorado business date.");
  return date;
}
const notDue = (reason: string): Decision => ({
  status: "NOT_DUE",
  reason,
  saleOn: null,
  rateId: null,
  amountCents: null,
  collectedFromCustomer: null,
});
const pending = (
  reason: string,
  status: RdfRecordStatus = "PENDING_DECISION",
): Decision => ({
  status,
  reason,
  saleOn: null,
  rateId: null,
  amountCents: null,
  collectedFromCustomer: null,
});

/** Count one issued Colorado retail invoice line once, never one per tax jurisdiction. */
async function recordedRetailSales(tx: Tx, year: number): Promise<number> {
  const lines = await tx.invoiceLineItem.findMany({
    where: {
      kind: {
        notIn: [
          "DEPOSIT",
          "TAX",
          "RETAIL_DELIVERY_FEE",
          "CREDIT",
          "PREPAY_DISCOUNT",
          "LATE_RETURN_WAIVER",
        ],
      },
      invoice: {
        agreement: { serviceAddress: { state: "CO" } },
        status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
        issuedAt: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    },
    select: { amountCents: true },
  });
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!Number.isSafeInteger(total))
    throw new Error("Sales total is outside integer cents range.");
  return Math.max(0, total);
}

async function firstRentSaleDate(
  tx: Tx,
  agreementId: string,
  prepaid: boolean,
): Promise<Date | null> {
  if (prepaid) {
    // Receipt.receivedOn is the actual settled cash-event date. Payment.createdAt
    // is only our webhook/manual-entry time and can be days later.
    const payments = await tx.payment.findMany({
      where: {
        status: { in: [...SUCCESSFUL_PAYMENT_STATUSES] },
        receiptId: { not: null },
        invoice: { agreementId, lineItems: { some: { kind: "RENTAL" } } },
      },
      select: { receipt: { select: { receivedOn: true } } },
    });
    const dates = payments.flatMap(p => p.receipt ? [p.receipt.receivedOn] : []);
    return dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : null;
  }
  const invoice = await tx.invoice.findFirst({
    where: {
      agreementId,
      status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
      issuedAt: { not: null },
      lineItems: { some: { kind: "RENTAL" } },
    },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    select: { issuedAt: true },
  });
  return invoice?.issuedAt ?? null;
}

async function decide(
  tx: Tx,
  agreementId: string,
  deliveredOn: Date,
): Promise<Decision> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      paidInFullInAdvance: true,
      serviceAddress: { select: { id: true, state: true } },
    },
  });
  if (agreement.serviceAddress.state !== "CO")
    return notDue("Delivery address is outside Colorado.");
  const location = await tx.addressTaxLocation.findFirst({
    where: { serviceAddressId: agreement.serviceAddress.id, isCurrent: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { status: true },
  });
  if (location?.status !== "VERIFIED")
    return pending("The delivery address needs a verified tax location.");
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: {
      shortTermLeaseElection: true,
      rdfThresholdCents: true,
      rdfThresholdCrossedOn: true,
      rdfHandling: true,
      rdfCpaConfirmedOn: true,
    },
  });
  if (!settings) return pending("Complete the business settings before deciding delivery fees.");
  const context = await getAgreementTaxContext(tx, agreementId, deliveredOn);
  const stateRows = await tx.taxJurisdiction.findMany({
    where: {
      id: { in: context.jurisdictions.map((j) => j.id) },
      level: "STATE",
    },
    select: { id: true },
  });
  if (stateRows.length !== 1)
    return pending(
      "Confirm the Colorado state tax jurisdiction for this address.",
    );
  const stateId = stateRows[0]!.id;
  const state = context.jurisdictions.find((j) => j.id === stateId)!;
  if (context.exemptJurisdictionIds.has(stateId))
    return notDue("The customer has a state exemption certificate.");
  const rental = resolveTaxability(state, "RENTAL", context);
  if (rental.taxability === "UNDECIDED") return pending(rental.reason);
  if (rental.taxability === "EXEMPT") return notDue(rental.reason);
  const year = Number(businessDateKey(deliveredOn).slice(0, 4));
  const [previous, current, account] = await Promise.all([
    recordedRetailSales(tx, year - 1),
    recordedRetailSales(tx, year),
    tx.taxFilingAccount.findFirst({
      where: {
        kind: "SALES_RETURN",
        jurisdictions: { some: { level: "STATE" } },
      },
      select: { frequency: true },
    }),
  ]);
  if (!account && previous === 0 && current > settings.rdfThresholdCents)
    return pending(
      "Confirm the Colorado filing frequency before calculating the 90-day grace period.",
    );
  const applicability = retailDeliveryFeeStatus({
    today: deliveredOn,
    saleType: "RENTAL",
    election: settings.shortTermLeaseElection,
    previousYearRetailCents: previous,
    currentYearRetailCents: current,
    thresholdCents: settings.rdfThresholdCents,
    thresholdCrossedOn: settings.rdfThresholdCrossedOn,
    frequency: account?.frequency ?? "MONTHLY",
    handling: settings.rdfHandling,
    cpaConfirmedOn: settings.rdfCpaConfirmedOn,
  });
  if (applicability.status === "UNDECIDED")
    return pending(applicability.reason);
  if (applicability.status !== "APPLIES") return notDue(applicability.reason);
  const saleEvidence = await firstRentSaleDate(
    tx,
    agreementId,
    agreement.paidInFullInAdvance,
  );
  if (!saleEvidence)
    return pending(
      "First rent is not yet finalized or prepaid rent has not settled.",
      "PENDING_RATE",
    );
  const saleOn = coDate(saleEvidence);
  const rates = await tx.retailDeliveryFeeRate.findMany({
    where: { effectiveOn: { lte: saleOn } },
    orderBy: [{ effectiveOn: "desc" }, { id: "desc" }],
    select: { id: true, effectiveOn: true, amountCents: true },
  });
  const rate = rdfRateForSale(saleOn, rates);
  if (!rate)
    return {
      ...pending(
        "Enter the delivery fee rate effective on the sale date.",
        "PENDING_RATE",
      ),
      saleOn,
    };
  return {
    status: "READY",
    reason: applicability.reason,
    saleOn,
    rateId: rate.id,
    amountCents: rate.amountCents,
    collectedFromCustomer: settings.rdfHandling === "COLLECT_FROM_CUSTOMER",
  };
}

/** One original sale per agreement. Never trust an arbitrary client-provided identity. */
export async function recordRentalDeliveryFeeInTx(
  tx: Tx,
  input: {
    jobId: string;
    agreementId: string;
    saleKey: string;
    deliveredOn: Date;
  },
): Promise<Result> {
  const saleKey = "agreement:" + input.agreementId;
  if (input.saleKey !== saleKey)
    throw new Error(
      "The delivery fee sale identity does not match this agreement.",
    );
  const job = await tx.job.findUnique({
    where: { id: input.jobId },
    select: {
      type: true,
      status: true,
      agreementId: true,
      appliances: { where: { result: "DELIVERED" }, select: { id: true } },
    },
  });
  if (
    !job ||
    job.agreementId !== input.agreementId ||
    job.status !== "COMPLETED" ||
    !["DELIVERY", "INSTALLATION"].includes(job.type) ||
    job.appliances.length === 0
  )
    return { recordId: null, status: null };
  const prior = await tx.retailDeliveryFeeRecord.findUnique({
    where: { saleKey },
  });
  if (prior && (prior.status === "READY" || prior.status === "NOT_DUE"))
    return { recordId: prior.id, status: prior.status };
  // Later partial-delivery trips must not change the original delivery date.
  const firstDeliveredOn = prior?.deliveredOn ?? coDate(input.deliveredOn);
  const decision = await decide(tx, input.agreementId, firstDeliveredOn);
  const data = {
    status: decision.status,
    rateId: decision.rateId,
    saleOn: decision.saleOn,
    amountCents: decision.amountCents,
    collectedFromCustomer: decision.collectedFromCustomer,
  };
  const row = await tx.retailDeliveryFeeRecord.upsert({
    where: { saleKey },
    create: {
      saleKey,
      agreementId: input.agreementId,
      firstJobId: input.jobId,
      deliveredOn: firstDeliveredOn,
      ...data,
    },
    update: data,
  });
  if (
    !prior ||
    prior.status !== row.status ||
    prior.saleOn?.getTime() !== row.saleOn?.getTime()
  ) {
    await tx.auditLog.create({
      data: {
        action: "tax.rdf.record",
        entityType: "RetailDeliveryFeeRecord",
        entityId: row.id,
        newValue: {
          saleKey,
          status: row.status,
          reason: decision.reason,
          deliveredOn: row.deliveredOn.toISOString(),
          saleOn: row.saleOn?.toISOString() ?? null,
          rateId: row.rateId,
          amountCents: row.amountCents,
        },
      },
    });
  }
  return { recordId: row.id, status: row.status };
}

/** Idempotent, bounded recovery. Does not charge a customer or contact a provider. */
export async function resolvePendingRdfRecords(
  _now: Date,
  limit: number,
): Promise<{ resolved: number; blocked: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Invalid RDF recovery limit.");
  const rows = await prisma.retailDeliveryFeeRecord.findMany({
    where: {
      status: { in: ["PENDING_DECISION", "PENDING_RATE"] },
      agreementId: { not: null },
      firstJobId: { not: null },
    },
    orderBy: [{ deliveredOn: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      agreementId: true,
      firstJobId: true,
      saleKey: true,
      deliveredOn: true,
    },
  });
  let resolved = 0,
    blocked = 0;
  for (const row of rows) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" = ${row.agreementId} FOR UPDATE`;
      return recordRentalDeliveryFeeInTx(tx, {
        jobId: row.firstJobId!,
        agreementId: row.agreementId!,
        saleKey: row.saleKey,
        deliveredOn: row.deliveredOn,
      });
    });
    if (result.status === "READY" || result.status === "NOT_DUE") resolved++;
    else blocked++;
  }
  return { resolved, blocked };
}
