import { TAX_CHARGE_CATEGORIES, type TaxChargeCategory } from "@/domains/tax/categories";

/**
 * Which taxability cell a Decisions & reviews subject stands for (pure). Shared by the registry and by the tax reads in
 * `src/domains/tax/locations.ts` (so a scheduled decision can be overlaid on the right cell before it is applied).
 *
 * - "STATE": the all-state default rules (`TaxabilityRule.jurisdictionId = null`), used by every state-collected
 *   area. Rent and late-return rent are not here: for state-collected areas they follow the short-term lease election
 *   (subject IN-33-ELECTION).
 * - "GREELEY": the City of Greeley (home-rule, collects its own tax). Its tax area exists once the first Greeley
 *   address has been looked up.
 */
export type TaxCellScope = "STATE" | "GREELEY";
export type TaxCellTarget = { scope: TaxCellScope; category: TaxChargeCategory };

export const STATE_CELL_CATEGORIES: TaxChargeCategory[] = TAX_CHARGE_CATEGORIES.filter(
  (category) => category !== "RENTAL" && category !== "LATE_RETURN",
);
export const GREELEY_CELL_CATEGORIES: TaxChargeCategory[] = [...TAX_CHARGE_CATEGORIES];

export function taxCellSubjectId(target: TaxCellTarget): string {
  if (target.scope === "GREELEY" && target.category === "RENTAL") return "IN-33-GREELEY";
  return `IN-34-${target.category.replaceAll("_", "-")}-${target.scope}`;
}

const BY_ID = new Map<string, TaxCellTarget>([
  ...STATE_CELL_CATEGORIES.map((category) => {
    const target = { scope: "STATE" as const, category };
    return [taxCellSubjectId(target), target] as const;
  }),
  ...GREELEY_CELL_CATEGORIES.map((category) => {
    const target = { scope: "GREELEY" as const, category };
    return [taxCellSubjectId(target), target] as const;
  }),
]);

/** The cell a subject id stands for, or null when the subject is not a taxability cell. */
export function taxCellForSubject(subjectId: string): TaxCellTarget | null {
  return BY_ID.get(subjectId) ?? null;
}

export function allTaxCellSubjectIds(): string[] {
  return [...BY_ID.keys()];
}

/** How the Greeley tax area is recognised among the looked-up areas (a city that collects its own tax). */
export const GREELEY_JURISDICTION_WHERE = {
  level: "CITY",
  administration: "SELF_COLLECTED",
  name: { contains: "Greeley", mode: "insensitive" },
} as const;
