import { addBusinessDays, businessDateKey, businessDayBounds } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { legalDueOn } from "@/domains/tax/filing-calendar";
import {
  taxReturnDueException,
  taxLicenseRenewalException,
  type ExceptionItem,
} from "@/domains/exceptions/rules";

export const TAX_FILING_ATTENTION_CAP = 50;
export type FilingAttentionSet = {
  returns: { rows: ExceptionItem[]; total: number };
  licenses: { rows: ExceptionItem[]; total: number };
};

/** Read-only Today projection, limited to visible filing dates and without customer data. */
export async function listTaxFilingAttention(
  now = new Date(),
  readOnly = false,
): Promise<FilingAttentionSet> {
  const licensesUntil = addBusinessDays(now, 60);
  // Re-check the Owner's CURRENT start setting. Previously created periods
  // may remain in the ledger after the start is moved forward; they must not
  // produce reminders or Today attention.
  const activeStarts = await prisma.taxFilingAccount.findMany({
    where: { active: true, firstPeriodStart: { not: null } },
    select: { id: true, firstPeriodStart: true },
  });
  const returnWhere: Prisma.TaxFilingPeriodWhereInput = {
    status: "OPEN",
    periodEnd: { lt: businessDayBounds(now).start },
    filingAccount: { active: true },
    OR: activeStarts.map((account) => ({
      filingAccountId: account.id,
      periodStart: { gte: account.firstPeriodStart! },
    })),
  };
  const licenseWhere = {
    active: true,
    licenseExpiresOn: { not: null, lte: licensesUntil },
  };
  const [returns, licenses, returnCount, licenseCount] = await Promise.all([
    activeStarts.length ? prisma.taxFilingPeriod.findMany({
      where: returnWhere,
      include: { filingAccount: { select: { name: true, reminderDaysBefore: true } } },
      orderBy: [{ periodEnd: "asc" }, { id: "asc" }],
      take: TAX_FILING_ATTENTION_CAP,
    }) : Promise.resolve([]),
    prisma.taxFilingAccount.findMany({
      where: licenseWhere,
      orderBy: [{ licenseExpiresOn: "asc" }, { id: "asc" }],
      take: TAX_FILING_ATTENTION_CAP,
    }),
    activeStarts.length ? prisma.taxFilingPeriod.count({ where: returnWhere }) : Promise.resolve(0),
    prisma.taxFilingAccount.count({ where: licenseWhere }),
  ]);

  return {
    returns: {
      rows: returns
        .filter((period) => businessDateKey(now) > businessDateKey(period.periodEnd))
        .map((period) => taxReturnDueException({
          accountName: period.filingAccount.name,
          periodId: period.id,
          periodEnd: period.periodEnd,
          dueOn: period.dueOn,
          legalDueOn: period.legalDueOn ?? legalDueOn(period.dueOn),
          reminderDaysBefore: period.filingAccount.reminderDaysBefore,
          zeroReturn: period.zeroReturn,
          readOnly,
          now,
        })),
      total: returnCount,
    },
    licenses: {
      rows: licenses
        .filter((account): account is typeof account & { licenseExpiresOn: Date } => account.licenseExpiresOn !== null)
        .map((account) => taxLicenseRenewalException({
          accountName: account.name,
          expiresOn: account.licenseExpiresOn,
          now,
          readOnly,
        })),
      total: licenseCount,
    },
  };
}

/** Unrefunded customer-collected over-reports cannot become state credits.
 * Show the owner exactly where to resolve them, without an extra cron. */
export async function listRdfRefundAttention(limit = 50): Promise<ExceptionItem[]> {
  const count = Math.min(Math.max(1, limit), TAX_FILING_ATTENTION_CAP);
  const records = await prisma.retailDeliveryFeeRecord.findMany({
    where: {
      status: "NOT_DUE", filingPeriodId: { not: null },
      creditAppliedPeriodId: null,
      OR: [{ customerRefundRef: null }, { customerRefundedAt: null }],
    },
    select: {
      id: true, deliveredOn: true, filingPeriodId: true,
      agreement: { select: { customerId: true } },
    },
    orderBy: [{ deliveredOn: "asc" }, { id: "asc" }], take: count,
  });
  const periodIds = [...new Set(records.map(r => r.filingPeriodId).filter((id): id is string => !!id))];
  const periods = await prisma.taxFilingPeriod.findMany({
    where: { id: { in: periodIds }, status: "FILED" },
    select: {
      id: true, worksheet: true,
      amendments: {
        where: { status: "FILED" }, orderBy: [{ sequence: "desc" }, { id: "desc" }],
        take: 1, select: { packet: true },
      },
    },
  });
  const frozenByPeriod = new Map(periods.map(period => {
    const amended = period.amendments[0]?.packet;
    const corrected = amended && typeof amended === "object" && !Array.isArray(amended)
      && "corrected" in amended ? amended.corrected : null;
    const source = (corrected ?? period.worksheet) as {
      rdf?: { sourceCollectedFromCustomer?: Record<string, boolean>;
        sourceAmountCents?: Record<string, number> };
    } | null;
    return [period.id, source?.rdf] as const;
  }));
  return records.flatMap(record => {
    const frozen = frozenByPeriod.get(record.filingPeriodId ?? "");
    if (!frozen?.sourceCollectedFromCustomer?.[record.id] || !record.agreement?.customerId) return [];
    const cents = frozen.sourceAmountCents?.[record.id];
    return [{
      category: "SALES_TAX" as const, severity: "high" as const,
      title: "Refund an over-collected Colorado delivery fee",
      detail: "Refund the customer " +
        (Number.isSafeInteger(cents) ? "$" + (cents! / 100).toFixed(2) : "the full recorded fee") +
        " before claiming a credit on the Colorado return.",
      href: "/desk/customers/" + record.agreement.customerId,
      since: record.deliveredOn,
    }];
  });
}
