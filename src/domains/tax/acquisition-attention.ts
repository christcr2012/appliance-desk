import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

/** Two summary rows on Today, not one alert per appliance or purchase line. */
export async function listAcquisitionTaxAttention(now = new Date()): Promise<ExceptionItem[]> {
  await requireRole("OWNER", "ADMIN");
  const todayKey = businessDateKey(now);
  const todayStart = businessDateFromKey(todayKey);
  if (!todayStart) throw new Error("Unable to resolve today in Colorado.");
  const [unknownCount, oldestUnknown, due, overdue] = await Promise.all([
    prisma.appliance.count({ where: { acquisitionTaxStatus: "UNKNOWN" } }),
    prisma.appliance.findFirst({
      where: { acquisitionTaxStatus: "UNKNOWN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
    prisma.purchaseUseTax.aggregate({
      where: { status: "DUE" },
      _sum: { useTaxDueCents: true }, _count: { _all: true },
    }),
    prisma.purchaseUseTax.aggregate({
      where: {
        status: "DUE",
        filingPeriod: {
          status: "OPEN",
          OR: [
            { legalDueOn: { lt: todayStart } },
            { legalDueOn: null, dueOn: { lt: todayStart } },
          ],
        },
      },
      _sum: { useTaxDueCents: true }, _count: { _all: true },
    }),
  ]);
  const result: ExceptionItem[] = [];
  if (unknownCount > 0) {
    result.push({
      category: "ACQUISITION_TAX_REVIEW",
      severity: "medium",
      title: `${unknownCount} appliance${unknownCount === 1 ? "" : "s"} need purchase-tax review`,
      detail: "Confirm seller tax, your purchase evidence and any outstanding information. Review the list before billing decisions depend on the appliance's tax status.",
      href: "/desk/inventory?taxStatus=UNKNOWN",
      since: oldestUnknown?.createdAt ?? now,
    });
  }
  const dueCents = due._sum.useTaxDueCents ?? 0;
  if (due._count._all > 0 && dueCents > 0) {
    const overdueCents = overdue._sum.useTaxDueCents ?? 0;
    result.push({
      category: "PURCHASE_USE_TAX_DUE",
      severity: overdue._count._all > 0 ? "high" : "medium",
      title: `Consumer use tax to review: $${(dueCents / 100).toFixed(2)}`,
      detail: `${due._count._all} purchase-tax line${due._count._all === 1 ? "" : "s"} remain due.` +
        (overdueCents > 0
          ? ` $${(overdueCents / 100).toFixed(2)} is linked to filing periods with past due dates as of ${businessDateKey(now)}.`
          : " Verify the filing deadline for each period."),
      href: "/desk/tax/use-tax-worksheets",
      since: now,
    });
  }
  return result;
}
