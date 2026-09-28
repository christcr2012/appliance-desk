import { prisma } from "@/lib/prisma";
import { computeAgreementEarnings } from "./earnings";

export type { AgreementEarnings } from "./earnings";

export type AgreementEarningsRow = {
  agreementId: string;
  customerId: string;
  customerName: string;
  estimatedCents: number;
  actualCents: number;
  gapCents: number;
};

export type EarningsReport = {
  rows: AgreementEarningsRow[];
  totals: { estimatedCents: number; actualCents: number; gapCents: number };
};

/**
 * The Reports page's "actual vs. estimated" table — one row per agreement
 * that has ever started billing, worst gap first, plus fleet-wide totals.
 * See src/domains/reports/earnings.ts for what "estimated" and "actual"
 * each mean and why. Agreements that never started billing (still
 * draft/awaiting signature, or blocked — see the exception inbox for
 * those) are left out entirely rather than shown as a $0 row, since
 * there's nothing to reconcile yet.
 */
export async function getEarningsReport(asOf: Date = new Date()): Promise<EarningsReport> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { billingStartedAt: { not: null } },
    select: {
      id: true,
      billingStartedAt: true,
      endDate: true,
      customer: { select: { id: true, user: { select: { name: true, email: true } } } },
      lines: { select: { monthlyPriceCents: true } },
      invoices: { select: { amountPaidCents: true } },
    },
  });

  const rows = agreements.map((agreement) => {
    const invoicePaidCents = agreement.invoices.reduce((sum, inv) => sum + inv.amountPaidCents, 0);
    const earnings = computeAgreementEarnings(
      {
        billingStartedAt: agreement.billingStartedAt,
        endDate: agreement.endDate,
        lines: agreement.lines,
        invoicePaidCents,
      },
      asOf,
    );
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
      estimatedCents: acc.estimatedCents + row.estimatedCents,
      actualCents: acc.actualCents + row.actualCents,
      gapCents: acc.gapCents + row.gapCents,
    }),
    { estimatedCents: 0, actualCents: 0, gapCents: 0 },
  );

  return { rows, totals };
}

/**
 * Completed repair (MAINTENANCE_VISIT) jobs with no parts/labor cost
 * entered — the same rows the exception inbox flags (see
 * src/domains/exceptions), surfaced again here as their own list since
 * the Reports page is where Chris would notice his profitability numbers
 * looking off and want to know why.
 */
export async function getJobsMissingRepairCost() {
  return prisma.job.findMany({
    where: {
      type: "MAINTENANCE_VISIT",
      status: "COMPLETED",
      partsCostCents: null,
      laborCostCents: null,
    },
    select: {
      id: true,
      completedAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      appliances: {
        take: 1,
        select: { appliance: { select: { assetNumber: true, applianceType: { select: { name: true } } } } },
      },
    },
    orderBy: [{ completedAt: "asc" }],
  });
}
