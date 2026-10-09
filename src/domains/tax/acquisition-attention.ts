import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { explainPendingPurchaseTax } from "@/domains/tax/purchase-tax-explain";

/** Two summary rows on Today, not one alert per appliance or purchase line. */
export async function listAcquisitionTaxAttention(
  now = new Date(),
): Promise<ExceptionItem[]> {
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
      _sum: { useTaxDueCents: true },
      _count: { _all: true },
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
      _sum: { useTaxDueCents: true },
      _count: { _all: true },
    }),
  ]);
  const result: ExceptionItem[] = [];
  if (unknownCount > 0) {
    const items = await prisma.appliance.findMany({
      where: { acquisitionTaxStatus: "UNKNOWN" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true }, take: 60,
    });
    const explanations = await prisma.$transaction(tx =>
      Promise.all(items.map(a => explainPendingPurchaseTax(tx, a.id))));
    const reasons = new Map<string, { count: number; href: string; label: string }>();
    const wording: Record<string, string> = {
      ANSWER_LATER: "still need a purchase-tax answer",
      PURCHASE_DATE_OR_COST_MISSING: "need a purchase date or cost",
      ELECTION_UNDECIDED: "are waiting for your tax election",
      BUSINESS_ADDRESS_UNVERIFIED: "are waiting for your business address to be confirmed",
      RATES_UNREVIEWED: "are waiting for area rates to be reviewed",
    };
    for (const explanation of explanations) {
      const key = explanation.reason ?? "ANSWER_LATER";
      const current = reasons.get(key);
      reasons.set(key, { count: (current?.count ?? 0) + 1,
        href: explanation.fixHref ?? "/desk/inventory?taxStatus=UNKNOWN",
        label: explanation.fixLabel ?? "Review appliances" });
    }
    const groups = [...reasons.entries()].map(([key, group]) =>
      `${group.count} appliance${group.count === 1 ? "" : "s"} ${wording[key] ?? "need review"} — ${group.label}.`);
    if (unknownCount > items.length)
      groups.push(`And ${unknownCount - items.length} more appliances need review.`);
    const first = [...reasons.values()][0];
    result.push({
      category: "ACQUISITION_TAX_REVIEW",
      severity: "medium",
      title: `${unknownCount} appliance${unknownCount === 1 ? "" : "s"} need purchase-tax review`,
      detail: groups.join(" "),
      href: first?.href ?? "/desk/inventory?taxStatus=UNKNOWN",
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
      detail:
        `${due._count._all} purchase-tax line${due._count._all === 1 ? "" : "s"} remain due.` +
        (overdueCents > 0
          ? ` $${(overdueCents / 100).toFixed(2)} is linked to filing periods with past due dates as of ${businessDateKey(now)}.`
          : " Verify the filing deadline for each period."),
      href: "/desk/tax/use-tax-worksheets",
      since: now,
    });
  }
  const unlinked = await prisma.purchaseUseTax.findMany({
    where: { status: "DUE", filingPeriodId: null,
      jurisdiction: { useTaxFilingAccountId: null } },
    select: { createdAt: true, jurisdiction: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100,
  });
  if (unlinked.length) {
    const names = [...new Set(unlinked.map(row => row.jurisdiction.name))];
    const areas = names.slice(0, 4).join(", ") + (names.length > 4 ? " and more" : "");
    result.push({
      category: "PURCHASE_USE_TAX_DUE", severity: "high",
      title: "Use tax owed with nowhere to file it — " + areas,
      detail: "Link " + areas + " to a use-tax filing account so this tax lands on a return with a due date.",
      href: "/desk/sales-tax/setup#accounts",
      since: unlinked[0]!.createdAt,
    });
  }
  const rdfPending = await prisma.retailDeliveryFeeRecord.groupBy({
    by: ["status"],
    where: { status: { in: ["PENDING_DECISION", "PENDING_RATE"] } },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  for (const row of rdfPending) {
    result.push({
      category: "RETAIL_DELIVERY_FEE",
      severity: "high",
      title: row._count._all + " delivery fee records need review",
      detail:
        row.status === "PENDING_DECISION"
          ? "Check the Colorado delivery fee decision and verified location."
          : "Check the first rent charge date and the fee rate for that date.",
      href: "/desk/sales-tax/delivery-fees",
      since: row._min.createdAt ?? now,
    });
  }
  return result;
}
