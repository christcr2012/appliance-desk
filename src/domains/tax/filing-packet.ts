import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { addBusinessDays, businessDateKey } from "@/lib/business-date";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { taxCentsForLine } from "@/domains/billing/tax";
import { assignDueUseTaxRowsToPeriod } from "./use-tax";

export type FilingPacketRow = {
  jurisdictionId: string;
  name: string;
  filingCode: string | null;
  administration: "STATE_COLLECTED" | "SELF_COLLECTED";
  grossSalesCents: number;
  deductions: { key: string; label: string; cents: number }[];
  netTaxableCents: number;
  rateMilliPercent: number;
  taxCents: number;
  serviceFeeCents: number;
  remitCents: number;
};

export type FilingPacket = {
  account: {
    id: string;
    name: string;
    kind: "SALES_RETURN" | "USE_TAX_RETURN";
    accountNumber: string | null;
    portalUrl: string | null;
  };
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  legalDueOn: string;
  basis: "ACCRUAL" | "CASH";
  zeroReturn: boolean;
  rows: FilingPacketRow[];
  useTax: Array<{
    jurisdictionId: string;
    name: string;
    filingCode: string | null;
    purchaseCents: number;
    useTaxCents: number;
  }>;
  totals: {
    taxCents: number;
    serviceFeeCents: number;
    remitIfOnTimeCents: number;
    remitIfLateCents: number;
    remitCents: number;
  };
  steps: string[];
  warnings: string[];
};
export type FilingPacketLoad =
  | { status: "READY"; packet: FilingPacket }
  | { status: "BLOCKED"; problems: string[] };

type Labels = Record<string, { label: string; reportAs: "DEDUCTION" | "LEAVE_OUT_OF_GROSS" }>;
function labelsFrom(value: unknown): Labels {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const result: Labels = {};
  for (const [key, v] of Object.entries(value)) {
    if (!v || Array.isArray(v) || typeof v !== "object") continue;
    const item = v as { label?: unknown; reportAs?: unknown };
    if (typeof item.label !== "string" || !item.label.trim()) continue;
    if (item.reportAs !== "DEDUCTION" && item.reportAs !== "LEAVE_OUT_OF_GROSS") continue;
    result[key] = { label: item.label.trim(), reportAs: item.reportAs };
  }
  return result;
}
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function buildFilingPacket(input: {
  account: FilingPacket["account"] & { deductionLabels: unknown };
  period: { start: Date; end: Date; dueOn: Date; legalDueOn: Date };
  basis: "ACCRUAL" | "CASH";
  rows: FilingPacketRow[];
  useTax: FilingPacket["useTax"];
  viewedOn: Date;
}): FilingPacket {
  const config = labelsFrom(input.account.deductionLabels);
  const warnings: string[] = [];
  const onTime = businessDateKey(input.viewedOn) <= businessDateKey(input.period.legalDueOn);
  const rows = input.rows.map(row => {
    if (![row.grossSalesCents, row.netTaxableCents, row.taxCents, row.serviceFeeCents]
      .every(Number.isSafeInteger)) {
      throw new Error("Filing packet requires recorded integer-cent amounts.");
    }
    const deductions = row.deductions.map(d => {
      const mapped = config[d.key];
      if (!mapped) warnings.push(
        "Deduction " + d.key + " not decided — ask your CPA how it appears in SUTS.",
      );
      return { ...d, label: mapped?.label ?? "Not decided — ask your CPA" };
    });
    if (taxCentsForLine(row.netTaxableCents, row.rateMilliPercent) !== row.taxCents) {
      warnings.push("Stored per-bill rounding differs from whole-period arithmetic for " +
        row.name + ". Report the recorded tax; confirm with your CPA.");
    }
    return {
      ...row, deductions,
      remitCents: row.taxCents - (onTime ? row.serviceFeeCents : 0),
    };
  });
  const taxCents = sum(rows.map(row => row.taxCents)) + sum(input.useTax.map(row => row.useTaxCents));
  const serviceFeeCents = sum(rows.map(row => row.serviceFeeCents));
  const remitIfOnTimeCents = taxCents - serviceFeeCents;
  const zeroReturn = rows.every(row => row.grossSalesCents === 0 && row.taxCents === 0) &&
    input.useTax.every(row => row.useTaxCents === 0);
  const start = businessDateKey(input.period.start);
  const end = businessDateKey(input.period.end);
  const legal = businessDateKey(input.period.legalDueOn);
  const steps = [
    "Sign in to the official filing portal and choose " + input.account.name +
      (input.account.accountNumber ? " (account " + input.account.accountNumber + ")." : "."),
    (zeroReturn ? "Choose File a zero return" : "Choose File a return") +
      " for " + start + " through " + end + ".",
    ...rows.map(row =>
      row.name + (row.filingCode ? " (" + row.filingCode + ")" : "") +
      ": gross sales $" + money(row.grossSalesCents) +
      ", deductions " + (row.deductions.map(d => d.label + " $" + money(d.cents)).join("; ") || "$0.00") +
      ", taxable $" + money(row.netTaxableCents) + ", recorded tax $" + money(row.taxCents) + ".",
    ),
    ...input.useTax.map(row => row.name + ": purchase $" + money(row.purchaseCents) +
      ", use tax $" + money(row.useTaxCents) + "."),
    "Compare SUTS's total with $" + money(onTime ? remitIfOnTimeCents : taxCents) +
      ". If different, record the official amount; never silently change saved tax.",
    "Pay in the official portal, keep the confirmation number, and return to Appliance Desk to record filing.",
  ];
  if (!onTime) warnings.push(
    "After " + legal + " the return may carry penalty and interest. Use the amount shown by the filing portal.",
  );
  if (!input.account.accountNumber) warnings.push("Filing account number has not been entered.");
  warnings.push("Official SUTS field names must be verified with your CPA or filing account.");
  return {
    account: {
      id: input.account.id, name: input.account.name, kind: input.account.kind,
      accountNumber: input.account.accountNumber, portalUrl: input.account.portalUrl,
    },
    periodStart: start, periodEnd: end, dueOn: businessDateKey(input.period.dueOn),
    legalDueOn: legal, basis: input.basis, zeroReturn, rows, useTax: input.useTax,
    totals: {
      taxCents, serviceFeeCents, remitIfOnTimeCents,
      remitIfLateCents: taxCents, remitCents: onTime ? remitIfOnTimeCents : taxCents,
    },
    steps, warnings: [...new Set(warnings)],
  };
}

type TaxEvidence = {
  jurisdictionId: string;
  rateVersionId: string;
  category: string;
  taxableCents: number;
  exemptCents: number;
  exemptReason: string | null;
  taxCents: number;
  jurisdiction: {
    name: string;
    filingCode: string | null;
    filingOrder: number;
    administration: "STATE_COLLECTED" | "SELF_COLLECTED";
    serviceFeeMilliPercent: number;
  };
  rateVersion: { rateMilliPercent: number };
};

function deductionKey(reason: string | null, category: string): string {
  const label = reason?.toUpperCase() ?? "";
  if (/SHORT.TERM|ACQUISITION/.test(label)) return "EXEMPT_SHORT_TERM_RENTAL";
  if (/CUSTOMER|CERTIFICATE/.test(label)) return "EXEMPT_CUSTOMER_OTHER";
  if (/OUTSIDE/.test(label)) return "OUTSIDE_AREA";
  if (!category) throw new Error("Missing stored tax category.");
  return "NOT_TAXED_CATEGORY";
}

function aggregate(
  records: Array<{ tax: TaxEvidence; taxableCents: number; exemptCents: number; taxCents: number }>,
): FilingPacketRow[] {
  const grouped = new Map<string, { tax: TaxEvidence; taxable: number; exempt: Map<string, number>; collected: number }>();
  for (const record of records) {
    const { tax } = record;
    const key = tax.jurisdictionId + ":" + tax.rateVersionId;
    let row = grouped.get(key);
    if (!row) {
      row = { tax, taxable: 0, exempt: new Map(), collected: 0 };
      grouped.set(key, row);
    }
    row.taxable += record.taxableCents;
    row.collected += record.taxCents;
    if (record.exemptCents !== 0) {
      const reason = deductionKey(tax.exemptReason, tax.category);
      row.exempt.set(reason, (row.exempt.get(reason) ?? 0) + record.exemptCents);
    }
  }
  return [...grouped.values()].sort((a, b) =>
    a.tax.jurisdiction.filingOrder - b.tax.jurisdiction.filingOrder ||
    a.tax.jurisdictionId.localeCompare(b.tax.jurisdictionId) ||
    a.tax.rateVersion.rateMilliPercent - b.tax.rateVersion.rateMilliPercent,
  ).map(row => {
    const j = row.tax.jurisdiction;
    const deductions = [...row.exempt].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, cents]) => ({ key, label: key, cents }));
    const gross = row.taxable + sum(deductions.map(d => d.cents));
    const serviceFeeCents = taxCentsForLine(row.collected, j.serviceFeeMilliPercent);
    return {
      jurisdictionId: row.tax.jurisdictionId,
      name: j.name,
      filingCode: j.filingCode,
      administration: j.administration,
      grossSalesCents: gross,
      deductions,
      netTaxableCents: row.taxable,
      rateMilliPercent: row.tax.rateVersion.rateMilliPercent,
      taxCents: row.collected,
      serviceFeeCents,
      remitCents: row.collected - serviceFeeCents,
    };
  });
}

export async function loadFilingPacket(periodId: string, now = new Date()): Promise<FilingPacketLoad> {
  await requireRole("OWNER", "ADMIN");
  const period = await prisma.taxFilingPeriod.findUnique({
    where: { id: periodId }, include: { filingAccount: true },
  });
  if (!period) return { status: "BLOCKED", problems: ["Filing period was not found."] };
  if (period.filingAccount.basis === "UNDECIDED") {
    return { status: "BLOCKED", problems: ["Ask your CPA to choose cash or accrual before filing."] };
  }
  if (period.status === "FILED") {
    return { status: "BLOCKED", problems: ["The return has been filed; use its frozen packet or amendment review."] };
  }
  const endExclusive = addBusinessDays(period.periodEnd, 1);
  const account = period.filingAccount;
  const problems: string[] = [];

  // Never mutate a filed period or confuse use tax with sales tax.
  if (account.kind === "USE_TAX_RETURN") {
    await prisma.$transaction(async tx => {
      await assignDueUseTaxRowsToPeriod(tx, periodId);
    });
  }
  const useRows = account.kind === "USE_TAX_RETURN"
    ? await prisma.purchaseUseTax.findMany({
        where: { filingPeriodId: periodId, status: "DUE" },
        include: { jurisdiction: true },
        orderBy: [{ purchasedOn: "asc" }, { id: "asc" }],
      })
    : [];
  const useTaxMap = new Map<string, FilingPacket["useTax"][number]>();
  for (const item of useRows) {
    const old = useTaxMap.get(item.jurisdictionId);
    useTaxMap.set(item.jurisdictionId, {
      jurisdictionId: item.jurisdictionId,
      name: item.jurisdiction.name,
      filingCode: item.jurisdiction.filingCode,
      purchaseCents: (old?.purchaseCents ?? 0) + item.purchaseAmountCents,
      useTaxCents: (old?.useTaxCents ?? 0) + item.useTaxDueCents,
    });
  }
  const useTax = [...useTaxMap.values()].sort((a,b) => a.jurisdictionId.localeCompare(b.jurisdictionId));
  const evidence: Array<{ tax: TaxEvidence; taxableCents: number; exemptCents: number; taxCents: number }> = [];
  if (account.kind === "SALES_RETURN") {
    const where = account.basis === "ACCRUAL"
      ? { invoice: { createdAt: { gte: period.periodStart, lt: endExclusive } } }
      : { invoice: { payments: { some: {
          status: "succeeded", receipt: { receivedOn: { gte: period.periodStart, lt: endExclusive } },
        } } } };
    const lines = await prisma.invoiceTaxLine.findMany({
      where: { jurisdiction: { filingAccountId: account.id }, ...where },
      include: {
        jurisdiction: true, rateVersion: true,
        invoice: {
          include: {
            payments: { include: { receipt: true } },
            refunds: true,
            taxLines: { select: { id: true, taxCents: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const line of lines) {
      if (line.invoice.refunds.length > 0) {
        problems.push("A refund on invoice " + line.invoice.invoiceNumber +
          " needs explicit tax allocation before filing.");
        continue;
      }
      const amount = line.invoice.amountDueCents;
      if (account.basis === "ACCRUAL") {
        evidence.push({ tax: line, taxableCents: line.taxableCents,
          exemptCents: line.exemptCents, taxCents: line.taxCents });
        continue;
      }
      if (amount <= 0) {
        problems.push("Invoice " + line.invoice.invoiceNumber + " has no positive allocation base.");
        continue;
      }
      const payments = line.invoice.payments.filter(p =>
        p.status === "succeeded" && p.receipt &&
        p.receipt.receivedOn >= period.periodStart && p.receipt.receivedOn < endExclusive,
      );
      const taxLines = line.invoice.taxLines;
      const allTax = sum(taxLines.map(t => t.taxCents));
      if (allTax < 0 || allTax > amount || taxLines.some(t => t.taxCents < 0)) {
        problems.push("Invoice " + line.invoice.invoiceNumber + " has tax allocation that needs review.");
        continue;
      }
      let countTax = 0;
      let countTaxable = 0;
      let countExempt = 0;
      for (const payment of payments) {
        if (payment.amountCents <= 0 || payment.amountCents > amount) {
          problems.push("Invoice " + line.invoice.invoiceNumber + " has an invalid receipt allocation.");
          continue;
        }
        const paidTax = allocateAcrossLines(payment.amountCents, [allTax, amount - allTax])[0]!;
        const taxIndex = taxLines.findIndex(t => t.id === line.id);
        if (taxIndex < 0) {
          problems.push("An invoice tax line is missing from its payment allocation.");
          continue;
        }
        const taxShares = allTax > 0 ? allocateAcrossLines(paidTax, taxLines.map(t => t.taxCents)) : taxLines.map(() => 0);
        const principalShare = allocateAcrossLines(payment.amountCents,
          [line.taxableCents + line.exemptCents, Math.max(0, amount - line.taxableCents - line.exemptCents)])[0]!;
        countTax += taxShares[taxIndex]!;
        const [taxable, exempt] = allocateAcrossLines(principalShare, [Math.max(0,line.taxableCents), Math.max(0,line.exemptCents)]);
        countTaxable += taxable!;
        countExempt += exempt!;
      }
      evidence.push({ tax: line, taxableCents: countTaxable, exemptCents: countExempt, taxCents: countTax });
    }
  }
  if (problems.length > 0) return { status: "BLOCKED", problems: [...new Set(problems)] };

  const packet = buildFilingPacket({
    account, period: {
      start: period.periodStart, end: period.periodEnd,
      dueOn: period.dueOn, legalDueOn: period.legalDueOn ?? period.dueOn,
    },
    basis: account.basis, rows: aggregate(evidence), useTax, viewedOn: now,
  });
  return { status: "READY", packet };
}
