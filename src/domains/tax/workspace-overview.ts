import { prisma } from "@/lib/prisma";
import { businessDayBounds } from "@/lib/business-date";
import { assertActiveTeamActor } from "@/lib/team-actor";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { loadFilingPacketInTx } from "@/domains/tax/filing-packet";
import { TAX_CHARGE_CATEGORIES } from "@/domains/tax/categories";

export type TaxSetupStepDTO = {
  key: string; title: string; complete: boolean; detail: string; href: string;
};
export type TaxReturnSummaryDTO = {
  id: string; name: string; kind: string; dueOn: Date; periodEnd: Date;
  status: string; href: string;
};
export type TaxAttentionKind = "OVERDUE" | "AMENDMENT" | "DUE" | "NOT_READY" | "SETUP" | "INFO";
export type TaxAttentionDTO = {
  kind: TaxAttentionKind; title: string; detail: string; href: string;
  sortAt: Date; id: string;
};
export type TaxWorkspaceOverview = {
  setup: TaxSetupStepDTO[];
  nextReturn: TaxReturnSummaryDTO | null;
  nextDue: TaxReturnSummaryDTO[];
  attention: TaxAttentionDTO[];
};
export const TAX_OVERVIEW_LIMIT = 25;
const order: Record<TaxAttentionKind, number> = {
  OVERDUE: 0, AMENDMENT: 1, DUE: 2, NOT_READY: 3, SETUP: 4, INFO: 5,
};
export function sortTaxAttention(rows: TaxAttentionDTO[]): TaxAttentionDTO[] {
  return [...rows].sort((a, b) =>
    order[a.kind] - order[b.kind] ||
    a.sortAt.getTime() - b.sortAt.getTime() ||
    a.id.localeCompare(b.id));
}

export function hasCompleteTaxabilityMatrix(
  taxRules: ReadonlyArray<{ jurisdictionId: string | null; category: string;
    taxability: string; cpaConfirmedOn: Date | null }>,
  liveAreas: ReadonlyArray<{ jurisdictionId: string; jurisdiction: { administration: string } }>,
): boolean {
  const ruleFor = (jurisdictionId: string | null, category: string) =>
    taxRules.find(rule => rule.jurisdictionId === jurisdictionId && rule.category === category);
  const confirmed = (rule: (typeof taxRules)[number] | undefined) =>
    Boolean(rule && rule.taxability !== "UNDECIDED" && rule.cpaConfirmedOn !== null);
  // A specific undecided override blocks fallback even where a state
  // collected default exists; home-rule areas always require own decisions.
  return liveAreas.length > 0 && liveAreas.length <= 200 &&
    TAX_CHARGE_CATEGORIES.every(category => confirmed(ruleFor(null, category))) &&
    liveAreas.every(area => TAX_CHARGE_CATEGORIES.every(category => {
      const specific = ruleFor(area.jurisdictionId, category);
      return specific ? confirmed(specific) :
        area.jurisdiction.administration === "STATE_COLLECTED" &&
          confirmed(ruleFor(null, category));
    }));
}

/** Private read model: dates and attention only. No tax entries are posted here. */
export async function getTaxWorkspaceOverview(
  actorId: string, now: Date = new Date(),
): Promise<TaxWorkspaceOverview> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("Enter a valid tax overview date.");
  const today = businessDayBounds(now).start;
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    // Apply the account start-date filter IN the query, before the top-N limit.
    // An owner may move firstPeriodStart after obsolete OPEN rows exist.
    const configuredStarts = await tx.taxFilingAccount.findMany({
      where: { active: true, firstPeriodStart: { not: null } },
      select: { id: true, firstPeriodStart: true },
    });
    const eligiblePeriods = configuredStarts.map(account => ({
      filingAccountId: account.id,
      periodStart: { gte: account.firstPeriodStart! },
    }));
    const [accounts, periods, amendments, sourceChanges, unknown, settings, taxRules,
      liveAreas, activeAccountCount, addressPending, businessAreas] =
      await Promise.all([
        tx.taxFilingAccount.findMany({
          where: { active: true },
          select: {
            id: true, name: true, kind: true, firstPeriodStart: true,
            accountNumber: true, basis: true, portalUrl: true,
            dueDayOfFollowingMonth: true,
          },
          orderBy: [{ name: "asc" }, { id: "asc" }], take: 200,
        }),
        tx.taxFilingPeriod.findMany({
          where: { status: "OPEN", filingAccount: { active: true },
            ...(eligiblePeriods.length ? { OR: eligiblePeriods } : { id: { in: [] } }),
          },
          include: { filingAccount: { select: { name: true, kind: true, firstPeriodStart: true } } },
          orderBy: [{ dueOn: "asc" }, { id: "asc" }], take: TAX_OVERVIEW_LIMIT,
        }),
        tx.taxFilingAmendment.findMany({
          where: { status: "OPEN" },
          select: { id: true, periodId: true, detectedAt: true, additionalTaxCents: true,
            period: { select: { filingAccount: { select: { name: true } } } } },
          orderBy: [{ detectedAt: "asc" }, { id: "asc" }], take: TAX_OVERVIEW_LIMIT,
        }),
        tx.officialSourceWatch.findMany({
          where: { active: true, OR: [
            { lastError: { not: null } },
            { lastChangedAt: { not: null } },
          ] },
          select: { id: true, label: true, lastError: true, lastChangedAt: true, reviewedAt: true },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 50,
        }),
        tx.appliance.count({ where: { acquisitionTaxStatus: "UNKNOWN" } }),
        tx.businessSettings.findUnique({ where: { id: "singleton" },
          select: { rdfCpaConfirmedOn: true, shortTermLeaseElection: true } }),
        tx.taxabilityRule.findMany({
          select: { jurisdictionId: true, category: true,
            taxability: true, cpaConfirmedOn: true },
        }),
        tx.addressTaxJurisdiction.findMany({
          where: { location: { isCurrent: true, status: "VERIFIED",
            serviceAddressId: { not: null } } },
          select: { jurisdictionId: true,
            jurisdiction: { select: { administration: true } } },
          take: 201,
        }),
        tx.taxFilingAccount.count({ where: { active: true } }),
        tx.addressTaxLocation.count({ where: {
          isCurrent: true, serviceAddressId: { not: null },
          status: { in: ["FAILED", "NEEDS_REVIEW"] },
        } }),
        tx.addressTaxLocation.findFirst({
          where: { forBusinessLocation: true, isCurrent: true },
          include: { jurisdictions: { include: { jurisdiction: {
            select: { useTaxFilingAccountId: true },
          } } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
      ]);
    const taxabilityComplete = hasCompleteTaxabilityMatrix(taxRules, liveAreas);
    const accountComplete = accounts.some(account =>
      account.kind === "SALES_RETURN" && account.accountNumber &&
      account.portalUrl && account.firstPeriodStart && account.basis !== "UNDECIDED");
    const allStartsRecorded = activeAccountCount > 0 &&
      configuredStarts.length === activeAccountCount;
    const setup: TaxSetupStepDTO[] = [
      { key: "lease", title: "Short-term rental tax treatment",
        complete: Boolean(settings && settings.shortTermLeaseElection !== "UNDECIDED"),
        detail: !settings || settings.shortTermLeaseElection === "UNDECIDED"
          ? "Choose the short-term rental tax treatment before billing."
          : "Owner election recorded. Individual address/rate decisions are still mandatory at billing.",
        href: "/desk/sales-tax/setup" },
      { key: "areas", title: "Service address tax-area verification",
        complete: addressPending === 0,
        detail: addressPending > 0
          ? `${addressPending} addresses need review. Confirm the tax areas for this service address before billing.`
          : "No currently failed/pending address lookups; every new rental address still needs confirmation.",
        href: "/desk/sales-tax/areas" },
      { key: "accounts", title: "Filing accounts", complete: Boolean(accountComplete),
        detail: accountComplete ? "Configured sales-tax account recorded; verify each additional SUTS area." :
          "Enter the official sales-tax account number, portal, reporting basis and first period in Setup.",
        href: "/desk/sales-tax/setup" },
      { key: "use-accounts", title: "Use-tax filing accounts linked",
        complete: Boolean(businessAreas?.status === "VERIFIED" &&
          businessAreas.jurisdictions.length &&
          businessAreas.jurisdictions.every(area => area.jurisdiction.useTaxFilingAccountId)),
        detail: "Link every business tax area to a use-tax filing account, so purchase tax has a return and due date.",
        href: "/desk/sales-tax/setup#accounts" },
      { key: "periods", title: "Filing calendar", complete: allStartsRecorded,
        detail: "Set a first filing date for every active account before relying on reminders.",
        href: "/desk/sales-tax/setup" },
      { key: "taxability", title: "CPA-reviewed taxability", complete: taxabilityComplete,
        detail: taxabilityComplete ? "The recorded default and current verified-area taxability matrix is confirmed." :
          "Every applicable charge and current verified area's taxability must be CPA-confirmed; a single decided cell is not enough.",
        href: "/desk/sales-tax/taxability" },
      { key: "delivery", title: "Retail delivery fee decision", complete: Boolean(settings?.rdfCpaConfirmedOn),
        detail: "Confirm the payer, threshold and legal handling with the CPA.",
        href: "/desk/sales-tax/setup" },
    ];
    const nextDue = periods.filter(p => !p.filingAccount.firstPeriodStart ||
      p.periodStart >= p.filingAccount.firstPeriodStart).slice(0, 6).map(p => ({
      id: p.id, name: p.filingAccount.name, kind: p.filingAccount.kind,
      dueOn: p.legalDueOn ?? p.dueOn, periodEnd: p.periodEnd,
      status: p.status, href: `/desk/sales-tax/returns/${p.id}`,
    }));
    const attention: TaxAttentionDTO[] = [];
    for (const p of periods) {
      if (p.periodEnd >= today || (p.filingAccount.firstPeriodStart &&
        p.periodStart < p.filingAccount.firstPeriodStart)) continue;
      const href = `/desk/sales-tax/returns/${p.id}`;
      const dueOn = p.legalDueOn ?? p.dueOn;
      const overdue = dueOn < today;
      const packet = await loadFilingPacketInTx(tx, p.id, now, { assignUseTaxRows: false });
      const kind: TaxAttentionKind = overdue ? "OVERDUE" :
        packet.status === "BLOCKED" ? "NOT_READY" : "DUE";
      attention.push({
        kind, id: "period:" + p.id, sortAt: dueOn, href,
        title: overdue ? `Overdue return: ${p.filingAccount.name}` :
          packet.status === "BLOCKED" ? `Filing blocked: ${p.filingAccount.name}` :
          `Return due: ${p.filingAccount.name}`,
        detail: packet.status === "BLOCKED"
          ? packet.problems.slice(0, 3).join(" ") :
          `Review the official portal; deadline ${dueOn.toISOString().slice(0, 10)}. No payment is made by this page.`,
      });
    }
    for (const a of amendments) attention.push({
      kind: "AMENDMENT", id: "amend:" + a.id, sortAt: a.detectedAt,
      href: `/desk/sales-tax/returns/${a.periodId}/amend`,
      title: `Filing amendment: ${a.period.filingAccount.name}`,
      detail: "An original filed packet has a separately tracked correction. Owner filing evidence is still required.",
    });
    for (const step of setup.filter(s => !s.complete)) attention.push({
      kind: "SETUP", id: "setup:" + step.key, sortAt: today,
      href: step.href, title: step.title + " needs review", detail: step.detail,
    });
    for (const watch of sourceChanges.filter(watch => watch.lastError ||
      (watch.lastChangedAt && (!watch.reviewedAt || watch.lastChangedAt > watch.reviewedAt))).slice(0, 8))
      attention.push({
      kind: "INFO", id: "source:" + watch.id, sortAt: watch.lastChangedAt ?? today,
      href: "/desk/sales-tax/areas#sources",
      title: `Official source review: ${watch.label}`,
      detail: watch.lastError ? "Official source unavailable. Do not auto-accept a new rate." :
        "Official source changed; inspect the evidence before acknowledging.",
    });
    if (unknown > 0) attention.push({
      kind: "INFO", id: "acquisition:unknown", sortAt: today,
      href: "/desk/inventory?taxStatus=UNKNOWN",
      title: `${unknown} appliances have unknown acquisition-tax evidence`,
      detail: "Review affected appliances before treating their purchase tax status as verified; this is not a filing checklist item or a payment.",
    });
    return { setup, nextReturn: nextDue[0] ?? null, nextDue,
      attention: sortTaxAttention(attention).slice(0, TAX_OVERVIEW_LIMIT) };
  });
}



const TAX_TODAY_CATEGORIES = new Set([
  "SALES_TAX", "TAX_RETURN_DUE", "TAX_LICENSE_RENEWAL",
  "TAX_AMENDMENT_DUE", "TAX_FILING_NOT_READY",
  "ACQUISITION_TAX_REVIEW", "PURCHASE_USE_TAX_DUE", "RETAIL_DELIVERY_FEE",
]);

/** Reuse the exact owner/admin Today evidence and deep links instead of a
 * second incomplete tax alert projection. Distinct Today items remain visible
 * even when a different tax workspace notice points to the same screen. */
export function includeTodayTaxAttention(
  overview: TaxWorkspaceOverview,
  todayItems: ExceptionItem[],
): TaxWorkspaceOverview {
  const additional: TaxAttentionDTO[] = todayItems
    .filter(item => TAX_TODAY_CATEGORIES.has(item.category))
    .map((item, index) => ({
      kind: item.category === "TAX_AMENDMENT_DUE" ? "AMENDMENT" :
        item.category === "TAX_FILING_NOT_READY" ? "NOT_READY" :
        item.category === "TAX_RETURN_DUE" ? "DUE" : "INFO",
      id: "today:" + index + ":" + item.category,
      sortAt: item.since,
      title: item.title,
      detail: item.detail,
      href: item.href,
    }));
  const known = new Set(overview.attention.map(x => x.href + "\u0000" + x.title));
  const combined = [...overview.attention];
  for (const item of additional) {
    const key = item.href + "\u0000" + item.title;
    if (!known.has(key)) {
      combined.push(item);
      known.add(key);
    }
  }
  return { ...overview, attention: sortTaxAttention(combined).slice(0, TAX_OVERVIEW_LIMIT) };
}
