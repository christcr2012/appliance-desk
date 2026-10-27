import { getTaxYearFacts } from "./tax-facts";

/**
 * CMP-2 — quarterly estimated tax by the safe-harbor method.
 *
 * Federal: the required annual payment is 100% of last year's total tax,
 * or 110% when last year's federal AGI was over $150,000; each quarter
 * is a fourth of that. Colorado's DR 0104EP instructions (2026, read at
 * tax.colorado.gov on 2026-10-27) use the same prior-year safe harbor —
 * 100% of the preceding year's net Colorado tax, 110% when the federal
 * AGI was over the same line — so both jurisdictions share this math,
 * each from its own prior-year tax figure. (Colorado also allows 70% of
 * the actual current-year tax; the app does not compute that — see the
 * DQ-CMP-CO-EST Decisions question.)
 *
 * A first year with no prior-year facts produces NO number: the filing
 * says to enter an estimate from the CPA. Nothing is ever invented.
 */

export const HIGH_INCOME_AGI_CENTS = 15_000_000; // $150,000

export interface SafeHarbor {
  ratePercent: 100 | 110;
  annualCents: number;
  quarterCents: number;
}

/** The safe-harbor math. Pure: the unit tests pin it. */
export function safeHarbor(priorTaxCents: number, priorAgiCents: number | null): SafeHarbor {
  const ratePercent = priorAgiCents !== null && priorAgiCents > HIGH_INCOME_AGI_CENTS ? 110 : 100;
  const annualCents = Math.round((priorTaxCents * ratePercent) / 100);
  return { ratePercent, annualCents, quarterCents: Math.round(annualCents / 4) };
}

export type QuarterlyEstimate =
  | {
      status: "OK";
      jurisdiction: "FEDERAL" | "COLORADO";
      year: number;
      quarter: number;
      priorYear: number;
      priorTaxCents: number;
      ratePercent: 100 | 110;
      annualCents: number;
      quarterCents: number;
      method: string;
    }
  | {
      status: "NO_PRIOR_YEAR";
      jurisdiction: "FEDERAL" | "COLORADO";
      year: number;
      quarter: number;
      priorYear: number;
      method: string;
    };

const METHOD =
  "Safe harbor: a percentage of last year's tax (100%, or 110% when last year's federal income was over $150,000), divided by four. An estimate — your CPA confirms.";

export async function estimateQuarterlyTax(
  year: number,
  quarter: number,
  jurisdiction: "FEDERAL" | "COLORADO",
): Promise<QuarterlyEstimate> {
  if (![1, 2, 3, 4].includes(quarter)) throw new Error("That quarter could not be read.");
  const priorYear = year - 1;
  const facts = await getTaxYearFacts(priorYear);
  const priorTaxCents = jurisdiction === "FEDERAL" ? facts?.federalTaxCents : facts?.coloradoTaxCents;
  if (!facts || priorTaxCents === null || priorTaxCents === undefined) {
    return { status: "NO_PRIOR_YEAR", jurisdiction, year, quarter, priorYear, method: METHOD };
  }
  const harbor = safeHarbor(priorTaxCents, facts.federalAgiCents ?? null);
  return {
    status: "OK",
    jurisdiction,
    year,
    quarter,
    priorYear,
    priorTaxCents,
    ratePercent: harbor.ratePercent,
    annualCents: harbor.annualCents,
    quarterCents: harbor.quarterCents,
    method: METHOD,
  };
}

/** The quarter (1-4) inside an estimate filing's period key ("2026-Q2"), or null. */
export function quarterOfPeriodKey(periodKey: string): number | null {
  const match = /-Q([1-4])$/.exec(periodKey);
  return match ? Number(match[1]) : null;
}

/** The tax year inside a filing's period key ("2026", "2026-Q2", "1099-2026"), or null. */
export function yearOfPeriodKey(periodKey: string): number | null {
  const match = /(20\d{2})/.exec(periodKey);
  return match ? Number(match[1]) : null;
}
