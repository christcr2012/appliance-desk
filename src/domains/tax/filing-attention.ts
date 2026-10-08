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
