import { addBusinessDays, businessDateKey } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
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
  const tomorrow = addBusinessDays(now, 1);
  const licensesUntil = addBusinessDays(now, 60);
  const returnWhere = {
    status: "OPEN" as const,
    periodEnd: { lt: tomorrow },
    filingAccount: { active: true },
  };
  const licenseWhere = {
    active: true,
    licenseExpiresOn: { not: null, lt: licensesUntil },
  };
  const [returns, licenses, returnCount, licenseCount] = await Promise.all([
    prisma.taxFilingPeriod.findMany({
      where: returnWhere,
      include: { filingAccount: { select: { name: true } } },
      orderBy: [{ periodEnd: "asc" }, { id: "asc" }],
      take: TAX_FILING_ATTENTION_CAP,
    }),
    prisma.taxFilingAccount.findMany({
      where: licenseWhere,
      orderBy: [{ licenseExpiresOn: "asc" }, { id: "asc" }],
      take: TAX_FILING_ATTENTION_CAP,
    }),
    prisma.taxFilingPeriod.count({ where: returnWhere }),
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
