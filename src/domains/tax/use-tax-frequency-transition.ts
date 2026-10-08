import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { dueOnFor, legalDueOn } from "./filing-calendar";
import { chooseUseTaxFrequency } from "./use-tax-frequency";

function fromKey(value: string): Date {
  const result = businessDateFromKey(value);
  if (!result) throw new Error("Invalid Colorado business date: " + value);
  return result;
}

/**
 * Prospective Colorado STATE consumer use-tax annual -> monthly transition.
 *
 * The prior annual period remains the authoritative owner of purchases dated
 * before the transition. A future-dated assignment is detached and will be
 * picked up by the corresponding new monthly period when the calendar runs.
 * Home-rule use-tax accounts with no STATE jurisdiction are not modified.
 *
 * This is safe to call on each calendar run, including after interrupted runs.
 */
export async function advanceColoradoUseTaxFrequency(
  accountId: string,
  now: Date,
): Promise<boolean> {
  const today = businessDateKey(now);
  const [year, month] = today.split("-").map(Number);
  if (!year || !month) throw new Error("Invalid Colorado date.");
  // The most recently finished month is the latest eligible month boundary.
  const closedEnd = new Date(Date.UTC(year, month - 1, 0));
  const closedEndKey = closedEnd.toISOString().slice(0, 10);
  const [closedYear] = closedEndKey.split("-").map(Number);
  const yearStart = fromKey(`${closedYear}-01-01`);
  const monthEnd = fromKey(closedEndKey);
  const nextStart = fromKey(`${year}-${String(month).padStart(2, "0")}-01`);

  return prisma.$transaction(async (tx) => {
    // Serialize frequency changes with other calendar runs for this account.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"use-tax-frequency:" + accountId}))::text AS locked`;
    const account = await tx.taxFilingAccount.findUnique({
      where: { id: accountId },
      include: { useTaxJurisdictions: { select: { level: true } } },
    });
    if (!account || !account.active || account.kind !== "USE_TAX_RETURN" ||
        account.frequency !== "ANNUAL" || !account.firstPeriodStart ||
        !account.useTaxJurisdictions.some(j => j.level === "STATE")) return false;

    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { useTaxMonthlyThresholdCents: true },
    });
    const threshold = settings?.useTaxMonthlyThresholdCents ?? 30000;
    const due = await tx.purchaseUseTax.aggregate({
      where: {
        status: { in: ["DUE", "FILED"] },
        jurisdiction: { useTaxFilingAccountId: accountId },
        purchasedOn: { gte: yearStart, lt: nextStart },
      },
      _sum: { useTaxDueCents: true },
    });
    const decision = chooseUseTaxFrequency({
      yearDueCents: due._sum.useTaxDueCents ?? 0,
      thresholdCents: threshold,
      currentFrequency: "ANNUAL",
      monthEnd,
    });
    if (decision.frequency !== "MONTHLY") return false;

    const annualCandidate = await tx.taxFilingPeriod.findFirst({
      where: {
        filingAccountId: accountId,
        periodStart: { lte: monthEnd },
        periodEnd: { gte: monthEnd },
      },
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
    });
    // No annual period has been generated yet. Keep the account annual until
    // the calendar establishes one; never create overlapping inferred periods.
    if (!annualCandidate) return false;
    // markPeriodFiled() locks this same row before capturing the final packet.
    // Lock and re-read *before* detaching purchase evidence or editing dates.
    await tx.$queryRaw`SELECT "id" FROM "TaxFilingPeriod" WHERE "id" = ${annualCandidate.id} FOR UPDATE`;
    const annualPeriod = await tx.taxFilingPeriod.findUniqueOrThrow({
      where: { id: annualCandidate.id },
    });
    if (annualPeriod.status === "FILED" &&
        annualPeriod.periodEnd.getTime() > monthEnd.getTime()) {
      throw new Error("A filed annual return overlaps the proposed monthly transition.");
    }
    const crossingIntoAnnual = annualPeriod.periodEnd.getTime() > monthEnd.getTime();
    if (crossingIntoAnnual && annualPeriod.status !== "OPEN") {
      throw new Error("Cannot partition a filed use-tax return.");
    }
    const later = await tx.taxFilingPeriod.findFirst({
      where: {
        filingAccountId: accountId,
        id: { not: annualPeriod.id },
        periodEnd: { gte: nextStart },
        periodStart: { lte: annualPeriod.periodEnd },
      },
    });
    if (later) throw new Error("Existing filing periods overlap the proposed use-tax transition.");

    if (crossingIntoAnnual) {
      const filedRows = await tx.purchaseUseTax.count({
        where: {
          filingPeriodId: annualPeriod.id,
          purchasedOn: { gte: nextStart },
          status: "FILED",
        },
      });
      if (filedRows) throw new Error("Filed purchase rows cannot be moved to another filing period.");
      await tx.purchaseUseTax.updateMany({
        where: { filingPeriodId: annualPeriod.id, purchasedOn: { gte: nextStart } },
        data: { filingPeriodId: null },
      });
      const dueOn = dueOnFor(monthEnd, 20);
      const updated = await tx.taxFilingPeriod.updateMany({
        where: { id: annualPeriod.id, status: "OPEN" },
        data: { periodEnd: monthEnd, dueOn, legalDueOn: legalDueOn(dueOn) },
      });
      if (updated.count !== 1) throw new Error("The annual filing period was filed concurrently; no transition was applied.");
    }
    await tx.taxFilingAccount.update({
      where: { id: accountId },
      data: { frequency: "MONTHLY", dueDayOfFollowingMonth: 20 },
    });
    await tx.auditLog.create({
      data: {
        action: "tax.use_tax_frequency.transition",
        entityType: "TaxFilingAccount",
        entityId: accountId,
        oldValue: {
          frequency: "ANNUAL",
          preservedPeriodId: annualPeriod.id,
          preservedPeriodEnd: businessDateKey(annualPeriod.periodEnd),
        },
        newValue: {
          frequency: "MONTHLY",
          effectiveFrom: businessDateKey(decision.effectiveFrom),
          yearDueCents: due._sum.useTaxDueCents ?? 0,
          thresholdCents: threshold,
        },
      },
    });
    return true;
  });
}
