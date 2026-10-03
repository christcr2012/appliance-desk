import { prisma } from "@/lib/prisma";
import { computeAgreementEarnings } from "./earnings";

export type { AgreementEarnings } from "./earnings";

export type AgreementEarningsRow = {
  agreementId: string;
  customerId: string;
  customerName: string;
  expectedChargesCents: number;
  netCollectedCents: number;
  gapCents: number;
};

export type EarningsReport = {
  rows: AgreementEarningsRow[];
  totals: {
    expectedChargesCents: number;
    netCollectedCents: number;
    gapCents: number;
  };
};

/**
 * One ledger-basis reconciliation row per agreement that has started billing.
 * Expected charges are the agreement's invoices recorded by `asOf`. Net
 * collections are successful Receipt allocations to those invoices minus
 * recorded Refunds by `asOf`. Unallocated overpayment remains real customer
 * cash but is not attributed to an agreement until it is allocated.
 */
export async function getEarningsReport(asOf: Date = new Date()): Promise<EarningsReport> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { billingStartedAt: { not: null, lte: asOf } },
    select: {
      id: true,
      customer: {
        select: { id: true, user: { select: { name: true, email: true } } },
      },
      invoices: {
        where: { createdAt: { lte: asOf } },
        select: {
          amountDueCents: true,
          payments: {
            where: {
              status: "succeeded",
              receiptId: { not: null },
              receipt: { receivedOn: { lte: asOf } },
            },
            select: { amountCents: true },
          },
          refunds: {
            where: { createdAt: { lte: asOf } },
            select: { amountCents: true },
          },
        },
      },
    },
  });

  const rows = agreements.map((agreement) => {
    const expectedChargesCents = agreement.invoices.reduce(
      (sum, invoice) => sum + invoice.amountDueCents,
      0,
    );
    const grossAllocatedCents = agreement.invoices.reduce(
      (sum, invoice) =>
        sum + invoice.payments.reduce((paymentSum, payment) => paymentSum + payment.amountCents, 0),
      0,
    );
    const refundedCents = agreement.invoices.reduce(
      (sum, invoice) =>
        sum + invoice.refunds.reduce((refundSum, refund) => refundSum + refund.amountCents, 0),
      0,
    );
    const earnings = computeAgreementEarnings({
      expectedChargesCents,
      netCollectedCents: grossAllocatedCents - refundedCents,
    });

    return {
      agreementId: agreement.id,
      customerId: agreement.customer.id,
      customerName: agreement.customer.user.name ?? agreement.customer.user.email,
      ...earnings,
    };
  });

  rows.sort((a, b) => b.gapCents - a.gapCents);

  const totals = rows.reduce(
    (acc, row) => ({
      expectedChargesCents: acc.expectedChargesCents + row.expectedChargesCents,
      netCollectedCents: acc.netCollectedCents + row.netCollectedCents,
      gapCents: acc.gapCents + row.gapCents,
    }),
    { expectedChargesCents: 0, netCollectedCents: 0, gapCents: 0 },
  );

  return { rows, totals };
}

/**
 * Completed repair (MAINTENANCE_VISIT) jobs with missing cost inputs. Either
 * missing side makes profitability incomplete, so the report flags a row when
 * parts OR labor cost is null rather than only when both are absent.
 */
export async function getJobsMissingRepairCost() {
  return prisma.job.findMany({
    where: {
      type: "MAINTENANCE_VISIT",
      status: "COMPLETED",
      OR: [{ partsCostCents: null }, { laborCostCents: null }],
    },
    select: {
      id: true,
      completedAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      appliances: {
        take: 1,
        select: {
          appliance: {
            select: {
              assetNumber: true,
              applianceType: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ completedAt: "asc" }],
  });
}

export { getAccountingTransactions } from "./accounting-export";
export type {
  AccountingTransactionRow,
  AccountingTransactionType,
} from "./accounting-export";
