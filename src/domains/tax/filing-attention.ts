import { addBusinessDays, businessDateFromKey, businessDateKey, businessDayBounds } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { legalDueOn } from "@/domains/tax/filing-calendar";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { getRuleTimingSettings } from "@/domains/rules/reads";
import { fileAndPayOnDate, whenToAct } from "@/domains/rules/timing";
import {
  taxReturnDueException,
  taxLicenseRenewalException,
  taxSetupCheckDue,
  taxSetupCheckException,
  useTaxResetException,
  expiredExemptionException,
  filingFrequencyAdviceException,
  customerContact,
  type ExceptionItem,
} from "@/domains/exceptions/rules";

export const TAX_FILING_ATTENTION_CAP = 50;
/** Totals are worked out for the first few open returns only; more than this is already a catch-up situation. */
export const TAX_FILING_AMOUNT_CAP = 12;
export type FilingAttentionSet = {
  returns: { rows: ExceptionItem[]; total: number };
  licenses: { rows: ExceptionItem[]; total: number };
  /** Yearly "check your SUTS setup" reminders (BATCH-T 11.13). */
  setupChecks: { rows: ExceptionItem[]; total: number };
};

/** Read-only Today projection, limited to visible filing dates and without customer data. */
export async function listTaxFilingAttention(
  now = new Date(),
  readOnly = false,
): Promise<FilingAttentionSet> {
  // TFA-2 §10: the license reminder appears at the timing point (section 3):
  // the owner's chosen percent through the renewal window, November 1
  // through December 31 of the expiry year. The query prefilter is generous
  // and the act-on day is applied below; without timing settings the old
  // fixed 60-business-day window stands.
  const timing = await getRuleTimingSettings().catch(() => null);
  const licensesUntil = timing
    ? new Date(now.getTime() + 800 * 24 * 3600 * 1000)
    : addBusinessDays(now, 60);
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
  const setupAccounts = await prisma.taxFilingAccount.findMany({
    where: { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, name: true, setupCheckedOn: true, firstPeriodStart: true },
  });
  const setupDue = setupAccounts.filter((a) => taxSetupCheckDue(a.setupCheckedOn, a.firstPeriodStart !== null, now));
  const [returns, licenses, returnCount, licenseCount] = await Promise.all([
    activeStarts.length ? prisma.taxFilingPeriod.findMany({
      where: returnWhere,
      include: { filingAccount: { select: { name: true, kind: true, reminderDaysBefore: true } } },
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

  const closed = returns.filter((period) => businessDateKey(now) > businessDateKey(period.periodEnd));
  // W-9: say exactly how much to file and pay. Totals come from the same filing packet the return page
  // uses; a period whose packet is blocked (or beyond the first few) keeps the plain "return due" wording.
  const amounts = new Map<string, number>();
  await Promise.all(closed.slice(0, TAX_FILING_AMOUNT_CAP).map(async (period) => {
    try {
      const loaded = await loadFilingPacket(period.id, now);
      if (loaded.status !== "READY") return;
      const packet = loaded.packet;
      amounts.set(period.id, packet.account.kind === "RETAIL_DELIVERY_FEE_RETURN" && packet.rdf
        ? packet.rdf.taxDueCents : packet.totals.remitCents);
    } catch {
      // Leave this period on the plain wording; Today must still load.
    }
  }));

  // TFA-1: the day the timing rule says to act. A missing rule never blocks Today.
  const actOnKeyFor = (period: (typeof returns)[number]): string | undefined => {
    if (!timing) return undefined;
    try {
      return businessDateKey(fileAndPayOnDate({
        periodEnd: period.periodEnd,
        legalDueOn: period.legalDueOn ?? legalDueOn(period.dueOn),
        now, percent: timing.percent, marginBusinessDays: timing.marginBusinessDays,
      }));
    } catch {
      return undefined;
    }
  };

  // TFA-2 §10: with timing settings, a license shows once its act-on day
  // arrives inside the renewal window the spec sets (section 3:
  // November 1 through December 31 of the expiry year). A date that
  // cannot be evaluated still shows: an early license reminder is safer
  // than a missed one.
  const licenseDue = (account: (typeof licenses)[number]): boolean => {
    if (!timing || !account.licenseExpiresOn) return true;
    try {
      const expiryKey = businessDateKey(account.licenseExpiresOn);
      const opens = businessDateFromKey(`${expiryKey.slice(0, 4)}-11-01`);
      if (!opens) return true;
      const actOn = whenToAct({
        opens, closes: account.licenseExpiresOn, effect: "COSTS", now,
        percent: timing.percent, marginBusinessDays: timing.marginBusinessDays,
      }).actOn;
      return businessDateKey(actOn) <= businessDateKey(now);
    } catch {
      return true;
    }
  };
  const dueLicenses = licenses.filter(licenseDue);

  return {
    returns: {
      rows: closed
        .map((period) => taxReturnDueException({
          amountCents: amounts.get(period.id) ?? null,
          kind: period.filingAccount.kind,
          accountName: period.filingAccount.name,
          periodId: period.id,
          periodEnd: period.periodEnd,
          dueOn: period.dueOn,
          legalDueOn: period.legalDueOn ?? legalDueOn(period.dueOn),
          actOnKey: actOnKeyFor(period),
          reminderDaysBefore: period.filingAccount.reminderDaysBefore,
          zeroReturn: period.zeroReturn,
          readOnly,
          now,
        })),
      total: returnCount,
    },
    licenses: {
      rows: dueLicenses
        .filter((account): account is typeof account & { licenseExpiresOn: Date } => account.licenseExpiresOn !== null)
        .map((account) => taxLicenseRenewalException({
          accountName: account.name,
          expiresOn: account.licenseExpiresOn,
          now,
          readOnly,
        })),
      total: timing ? dueLicenses.length : licenseCount,
    },
    setupChecks: {
      rows: setupDue.slice(0, TAX_FILING_ATTENTION_CAP).map((a) => taxSetupCheckException({
        accountId: a.id, accountName: a.name, setupCheckedOn: a.setupCheckedOn, now, readOnly,
      })),
      total: setupDue.length,
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
      invoice: { select: { customerId: true } },
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
    if (!frozen?.sourceCollectedFromCustomer?.[record.id] || !(record.agreement?.customerId ?? record.invoice?.customerId)) return [];
    const cents = frozen.sourceAmountCents?.[record.id];
    return [{
      category: "SALES_TAX" as const, severity: "high" as const,
      title: "Refund an over-collected Colorado delivery fee",
      detail: "Refund the customer " +
        (Number.isSafeInteger(cents) ? "$" + (cents! / 100).toFixed(2) : "the full recorded fee") +
        " before claiming a credit on the Colorado return.",
      href: "/desk/customers/" + (record.agreement?.customerId ?? record.invoice?.customerId),
      since: record.deliveredOn,
    }];
  });
}

/**
 * TFA-2 §7: "Use tax is back to one yearly return for {year}". Driven by the
 * reset audit the calendar writes on Jan 1; shown for 45 days, and only
 * while the account is still on the yearly cadence it announces.
 */
export async function listUseTaxResetAttention(now: Date): Promise<ExceptionItem[]> {
  const year = businessDateKey(now).slice(0, 4);
  const audits = await prisma.auditLog.findMany({
    where: {
      action: "tax.use_tax_frequency.reset",
      entityType: "TaxFilingAccount",
      createdAt: { gte: new Date(now.getTime() - 45 * 24 * 3600 * 1000) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, newValue: true, createdAt: true },
    take: 20,
  });
  const seen = new Set<string>();
  const rows = audits.flatMap((audit) => {
    const entityId = audit.entityId;
    if (!entityId) return [];
    if ((audit.newValue as { forYear?: string } | null)?.forYear !== year) return [];
    if (seen.has(entityId)) return [];
    seen.add(entityId);
    return [{ entityId, createdAt: audit.createdAt }];
  });
  if (!rows.length) return [];
  const accounts = await prisma.taxFilingAccount.findMany({
    where: { id: { in: rows.map((r) => r.entityId) }, frequency: "ANNUAL" },
    select: { id: true, name: true },
  });
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.flatMap((row) => {
    const name = nameById.get(row.entityId);
    if (!name) return [];
    return [useTaxResetException({
      accountId: row.entityId, accountName: name, year, since: row.createdAt,
    })];
  });
}

/**
 * TFA-2 §9: a customer's exemption certificate expired and they have been
 * billed since, so their bills charge tax again. One item per customer
 * (their latest expired certificate), and only while no current
 * certificate covers them.
 */
export async function listExpiredExemptionAttention(now: Date): Promise<ExceptionItem[]> {
  const todayStart = businessDayBounds(now).start;
  const expired = await prisma.customerTaxExemption.findMany({
    where: { revokedAt: null, expiresOn: { not: null, lt: todayStart } },
    orderBy: [{ expiresOn: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      customerId: true, expiresOn: true,
      customer: { select: { phone: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!expired.length) return [];
  const customerIds = [...new Set(expired.map((row) => row.customerId))];
  const [covered, billed] = await Promise.all([
    prisma.customerTaxExemption.findMany({
      where: {
        customerId: { in: customerIds }, revokedAt: null, validFrom: { lte: now },
        OR: [{ expiresOn: null }, { expiresOn: { gte: todayStart } }],
      },
      select: { customerId: true },
    }),
    prisma.invoice.findMany({
      where: {
        customerId: { in: customerIds },
        status: { notIn: ["DRAFT", "VOID", "WRITTEN_OFF"] },
        issuedAt: { not: null },
      },
      select: { customerId: true, issuedAt: true },
    }),
  ]);
  const coveredIds = new Set(covered.map((row) => row.customerId));
  const lastBilledBy = new Map<string, Date>();
  for (const invoice of billed) {
    if (!invoice.issuedAt) continue;
    const previous = lastBilledBy.get(invoice.customerId);
    if (!previous || invoice.issuedAt > previous) lastBilledBy.set(invoice.customerId, invoice.issuedAt);
  }
  const seen = new Set<string>();
  return expired.flatMap((row) => {
    if (!row.expiresOn || seen.has(row.customerId)) return [];
    seen.add(row.customerId);
    if (coveredIds.has(row.customerId)) return [];
    const lastBilled = lastBilledBy.get(row.customerId);
    if (!lastBilled || lastBilled < businessDayBounds(row.expiresOn).end) return [];
    return [expiredExemptionException({
      customerId: row.customerId,
      customerName: row.customer.user.name ?? row.customer.user.email,
      expiresOn: row.expiresOn,
      contact: customerContact({ phone: row.customer.phone, user: { email: row.customer.user.email } }),
    })];
  });
}

/**
 * TFA-2 §8: unconfirmed filing-frequency advice, one live item per account
 * (the newest advice), shown only while the account is still on the
 * frequency the advice was computed from.
 */
export async function listFilingFrequencyAdviceAttention(now: Date): Promise<ExceptionItem[]> {
  void now;
  const rows = await prisma.filingFrequencyAdvice.findMany({
    where: { confirmedAt: null },
    orderBy: [{ computedOn: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true, filingAccountId: true, currentFrequency: true,
      advisedFrequency: true, averageMonthlyCents: true, computedOn: true,
      filingAccount: { select: { name: true, frequency: true } },
    },
  });
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.filingAccountId)) return [];
    seen.add(row.filingAccountId);
    if (row.filingAccount.frequency !== row.currentFrequency) return [];
    return [filingFrequencyAdviceException({
      adviceId: row.id,
      accountName: row.filingAccount.name,
      currentFrequency: row.currentFrequency,
      advisedFrequency: row.advisedFrequency,
      averageMonthlyCents: row.averageMonthlyCents,
      since: row.computedOn,
    })];
  });
}
