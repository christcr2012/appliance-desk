import type { TaxChargeCategory } from "@/domains/tax/categories";
import type { Taxability } from "@/domains/tax/engine";

/**
 * Which taxable/exempt rule applied on a given date (DEC-1a, spec section 4a). Pure: the caller loads the current
 * rules, their history and any scheduled (not yet applied) decision changes; `locations.ts` does that.
 *
 * Per tax area × charge category:
 * 1. A scheduled change due by that date (newest first) wins, so tax is exact to the day before the nightly run.
 * 2. Otherwise the newest history version that started on or before that date — but only while history is
 *    trustworthy: when the stored rule no longer equals the newest version (it was changed outside the dated saves,
 *    e.g. by an older screen), the stored rule is used for every date, exactly as before history existed.
 * 3. With no history at all, the stored rule is used. With history but no version that early, nothing was decided
 *    on that date ("not decided"), so a rule saved today never reaches back to old service dates.
 */
export type TaxabilityCell = {
  jurisdictionId: string | null;
  category: TaxChargeCategory;
  taxability: Taxability;
  provisional: boolean;
  /** FEETAX-1: the optional-and-separately-stated answer for a service line; null/absent = same as taxability. */
  optionalSeparatedTreatment?: Taxability | null;
};
export type TaxabilityCellVersion = TaxabilityCell & { effectiveFrom: Date; createdAt: Date };
export type ScheduledTaxabilityCell = TaxabilityCell & { effectiveFrom: Date; createdAt: Date };

function cellKey(cell: { jurisdictionId: string | null; category: TaxChargeCategory }) {
  return `${cell.jurisdictionId ?? ""}|${cell.category}`;
}

function newestFirst(a: { effectiveFrom: Date; createdAt: Date }, b: { effectiveFrom: Date; createdAt: Date }) {
  return b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime();
}

function plain(cell: TaxabilityCell): TaxabilityCell {
  return { jurisdictionId: cell.jurisdictionId, category: cell.category, taxability: cell.taxability,
    provisional: cell.provisional, optionalSeparatedTreatment: cell.optionalSeparatedTreatment ?? null };
}

export function resolveTaxabilityAsOf(
  at: Date,
  current: TaxabilityCell[],
  versions: TaxabilityCellVersion[],
  scheduled: ScheduledTaxabilityCell[],
): TaxabilityCell[] {
  const keys = new Map<string, { jurisdictionId: string | null; category: TaxChargeCategory }>();
  const currentByKey = new Map<string, TaxabilityCell>();
  for (const cell of current) {
    currentByKey.set(cellKey(cell), cell);
    keys.set(cellKey(cell), cell);
  }
  const versionsByKey = new Map<string, TaxabilityCellVersion[]>();
  for (const version of versions) {
    const list = versionsByKey.get(cellKey(version)) ?? [];
    list.push(version);
    versionsByKey.set(cellKey(version), list);
  }
  const dueByKey = new Map<string, ScheduledTaxabilityCell[]>();
  for (const change of scheduled) {
    if (change.effectiveFrom.getTime() > at.getTime()) continue;
    const list = dueByKey.get(cellKey(change)) ?? [];
    list.push(change);
    dueByKey.set(cellKey(change), list);
    keys.set(cellKey(change), change);
  }

  const out: TaxabilityCell[] = [];
  for (const [key] of keys) {
    const due = dueByKey.get(key)?.sort(newestFirst)[0];
    if (due) {
      // A scheduled decision change carries only the regular answer; the optional-separate
      // answer keeps riding the stored rule (FEETAX-1).
      const stored = currentByKey.get(key);
      out.push({ ...plain(due), optionalSeparatedTreatment: stored?.optionalSeparatedTreatment ?? null });
      continue;
    }
    const row = currentByKey.get(key);
    if (!row) continue;
    const history = (versionsByKey.get(key) ?? []).sort(newestFirst);
    const newest = history[0];
    if (!newest || newest.taxability !== row.taxability || newest.provisional !== row.provisional
      || (newest.optionalSeparatedTreatment ?? null) !== (row.optionalSeparatedTreatment ?? null)) {
      out.push(plain(row));
      continue;
    }
    // Spec 4a: the newest version that started on or before `at`. None that early means nothing was decided then.
    const then = history.find((version) => version.effectiveFrom.getTime() <= at.getTime());
    out.push(plain(then ? { ...row, taxability: then.taxability, provisional: then.provisional,
        optionalSeparatedTreatment: then.optionalSeparatedTreatment ?? null }
      : { ...row, taxability: "UNDECIDED", provisional: false, optionalSeparatedTreatment: null }));
  }
  return out;
}
