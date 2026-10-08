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
  const lines = await tx.invoiceLineIte¶»§q«^