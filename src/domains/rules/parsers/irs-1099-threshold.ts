import { businessDateFromKey } from "@/lib/business-date";
import {
  pageToText,
  type ParseResult,
} from "./index";

/**
 * IRS instructions for Forms 1099-MISC and 1099-NEC (irs.gov/instructions/i1099mec).
 * The same reporting threshold must be stated for rents (Form 1099-MISC
 * box 1) and for nonemployee compensation (Form 1099-NEC): if the two ever
 * differ, one rule key cannot hold both, so the parse fails rather than
 * picking one silently. The tax year comes from the page's own revision
 * stamp in its title — the IRS publishes these instructions each December
 * for the tax year then ending (the (12/2026) revision governs payments
 * made in 2026) — so only a December revision parses, and the reading
 * takes effect January 1 of that year.
 * Verified against the live page on 2026-10-26: title "(12/2026)", rents
 * listed first under "At least $2,000 in:", NEC "paid at least $2,000 in:".
 */

export function parseIrs1099Threshold(pageText: string): ParseResult {
  const text = pageToText(pageText);

  const title = /Instructions for Forms 1099-MISC and 1099-NEC \((\d{2})\/(\d{4})\)/.exec(text);
  if (!title) return { ok: false, why: "The instructions title and revision date were not found." };
  if (title[1] !== "12") {
    return { ok: false, why: "The instructions are not the December revision, so the tax year is not stated." };
  }
  const taxYear = Number(title[2]);

  const rents = /At least \$([\d,]+) in:[\s\S]{0,60}?Rents \(box 1\)/.exec(text);
  if (!rents) return { ok: false, why: "The rents threshold was not found." };
  const nec = /Form 1099-NEC, Nonemployee Compensation,[\s\S]{0,240}?paid at least \$([\d,]+) in:/.exec(text);
  if (!nec) return { ok: false, why: "The nonemployee compensation threshold was not found." };

  const rentsDollars = Number(rents[1]!.replace(/,/g, ""));
  const necDollars = Number(nec[1]!.replace(/,/g, ""));
  if (!Number.isSafeInteger(rentsDollars) || !Number.isSafeInteger(necDollars)) {
    return { ok: false, why: "A threshold amount does not parse." };
  }
  if (rentsDollars !== necDollars) {
    return {
      ok: false,
      why: "The rents and nonemployee compensation thresholds differ, so one rule cannot hold both.",
    };
  }

  const effectiveFrom = businessDateFromKey(`${taxYear}-01-01`);
  if (!effectiveFrom) return { ok: false, why: "The tax year does not parse." };
  return {
    ok: true,
    values: [{ ruleKey: "us.1099.threshold", value: rentsDollars * 100, effectiveFrom }],
    evidence: `At least $${rents[1]} in rents (1099-MISC box 1) and at least $${nec[1]} in nonemployee compensation (1099-NEC), instructions revised 12/${taxYear}.`,
  };
}
