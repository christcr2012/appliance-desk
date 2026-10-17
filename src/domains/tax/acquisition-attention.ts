import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { explainPendingPurchaseTax } from "@/domains/tax/purchase-tax-explain";
import { loadApplianceTaxSteps, type PurchaseTaxStep } from "@/domains/tax/next-step";
import { loadReceiptTaxSteps } from "@/domains/purchasing/receipt-tax";

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
      select: { id: true, createdAt: true, purchaseId: true,
        purchase: { select: { sellerName: true, supplier: { select: { name: true } } } } },
      take: 60,
    });
    // W-2: one shared next step per appliance. Dated steps (check the receipt, ask the CPA) become one
    // To do per purchase; everything else stays in the setup summary below.
    const steps = await loadApplianceTaxSteps(prisma, items.map((a) => a.id), now);
    const dated = new Map<string, { href: string; seller: string | null; since: Date; steps: PurchaseTaxStep[] }>();
    const summarized: typeof items = [];
    for (const appliance of items) {
      const step = steps.get(appliance.id);
      if (!step?.todo) { summarized.push(appliance); continue; }
      const key = appliance.purchaseId ? "purchase:" + appliance.purchaseId + ":" + step.kind : "appliance:" + appliance.id;
      const group = dated.get(key) ?? {
        href: appliance.purchaseId ? "/desk/purchases/" + appliance.purchaseId : step.todo.primaryAction.href,
        seller: appliance.purchase ? appliance.purchase.supplier?.name ?? appliance.purchase.sellerName : null,
        since: appliance.createdAt, steps: [],
      };
      group.steps.push(step);
      dated.set(key, group);
    }
    const datedItems: ExceptionItem[] = [];
    for (const group of dated.values()) {
      const first = group.steps[0]!;
      const todo = first.todo!;
      const many = group.steps.length > 1;
      const title = many
        ? first.kind === "CPA_OTHER_STATE"
          ? "Ask your CPA about tax paid to another state on " + group.steps.length + " appliances" + (group.seller ? " from " + group.seller : "")
          : "Check the receipt for " + group.steps.length + " appliances" + (group.seller ? " from " + group.seller : "") + ": did the seller charge tax?"
        : todo.title;
      datedItems.push({
        category: "ACQUISITION_TAX_REVIEW",
        severity: group.steps.some((step) => step.todo?.severity === "high") ? "high" : todo.severity,
        title, detail: first.headline + " " + first.detail,
        href: group.href,
        dueOn: todo.dueOn ?? undefined, dueDateOnly: todo.dueOn ? true : undefined,
        primaryAction: { label: todo.primaryAction.label, href: group.href },
        since: group.since,
      });
    }
    const unsummarizedCount = unknownCount - (items.length - summarized.length);
    if (summarized.length > 0 || unknownCount > items.length) {
    const explanations = await prisma.$transaction(tx =>
      Promise.all(summarized.map(a => explainPendingPurchaseTax(tx, a.id))));
    const reasons = new Map<string, { count: number; href: string; label: string }>();
    const wording: Record<string, string> = {
      ANSWER_LATER: "still need a purchase-tax answer",
      PURCHASE_DATE_OR_COST_MISSING: "need a purchase date or cost",
      ELECTION_UNDECIDED: "are waiting for your tax election",
      BUSINESS_ADDRESS_UNVERIFIED: "are waiting for your business address to be confirmed",
      RATES_UNREVIEWED: "are waiting for area rates to be reviewed",
    };
    for (const explanation of explanations) {
      // No reason = no longer pending (answered or removed since the list above was read).
      if (!explanation.reason) continue;
      const key = explanation.reason;
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
    if (groups.length > 0) {
    result.push({
      category: "ACQUISITION_TAX_REVIEW",
      severity: "medium",
      title: `${unsummarizedCount} appliance${unsummarizedCount === 1 ? "" : "s"} need purchase-tax review`,
      detail: groups.join(" "),
      href: first?.href ?? "/desk/inventory?taxStatus=UNKNOWN",
      since: summarized[0]?.createdAt ?? oldestUnknown?.createdAt ?? now,
    });
    }
    }
    result.push(...datedItems);
  }
  // Parts delivered on purchase orders: one To do per delivery whose tax answer is still open.
  const openReceipts = await prisma.purchaseOrderReceiptTax.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true }, take: 200,
  });
  for (const step of await loadReceiptTaxSteps(prisma, openReceipts.map((r) => r.id), now)) {
    if (!step.todo && step.kind === "NEEDS_SETUP") {
      result.push({
        category: "ACQUISITION_TAX_REVIEW", severity: "medium",
        title: "Finish tax setup for parts received", detail: step.subject.label + ". " + step.headline + " " + step.detail,
        href: step.subject.blockedHref ?? step.subject.href, since: step.subject.recordedAt ?? now,
      });
      continue;
    }
    if (!step.todo) continue;
    result.push({
      category: "ACQUISITION_TAX_REVIEW", severity: step.todo.severity,
      title: step.todo.title, detail: step.headline + " " + step.detail,
      href: step.subject.href, dueOn: step.todo.dueOn ?? undefined, dueDateOnly: step.todo.dueOn ? true : undefined,
      primaryAction: step.todo.primaryAction, since: step.subject.recordedAt ?? now,
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
