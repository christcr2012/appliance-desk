import { businessDateFromKey } from "@/lib/business-date";
import {
  pageToLines,
  tableCells,
  type ParseResult,
  type ParsedRuleValue,
} from "./index";

/**
 * Colorado penalties and interest (tax.colorado.gov tax topics page). The
 * "Annual Interest Rates on Tax Underpayments" table lists, per calendar
 * year, the discounted and regular rates. Strict: the heading, the exact
 * column header and at least one fully parsing year row are required;
 * a line that starts a row (a four-digit year) but does not parse fails
 * the whole parse rather than being skipped.
 * Verified against the live page on 2026-10-26: 2026 shows 8% discounted
 * and 11% regular, matching the seeded rule.
 */

const HEADING = "Annual Interest Rates on Tax Underpayments";

export function parseCoInterest(pageText: string): ParseResult {
  const lines = pageToLines(pageText);
  const headingIndex = lines.findIndex((line) => line.includes(HEADING));
  if (headingIndex === -1) {
    return { ok: false, why: "The annual interest rates heading was not found." };
  }
  const headerIndex = lines.findIndex(
    (line, index) =>
      index > headingIndex &&
      tableCells(line).join("|") === "Calendar Year|Discounted Rate|Regular Rate",
  );
  if (headerIndex === -1) {
    return { ok: false, why: "The interest rates table header was not found." };
  }

  const values: ParsedRuleValue[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = tableCells(lines[index]!);
    if (cells.length === 0 || !/^\d{4}$/.test(cells[0]!)) break;
    if (cells.length !== 3) {
      return { ok: false, why: "An interest rate row does not have three cells." };
    }
    const discounted = /^(\d{1,2})%$/.exec(cells[1]!);
    const regular = /^(\d{1,2})%$/.exec(cells[2]!);
    if (!discounted || !regular) {
      return { ok: false, why: "An interest rate does not parse." };
    }
    const effectiveFrom = businessDateFromKey(`${cells[0]}-01-01`);
    if (!effectiveFrom) return { ok: false, why: "A calendar year does not parse." };
    values.push({
      ruleKey: "co.interest",
      value: { regular: Number(regular[1]), discounted: Number(discounted[1]) },
      effectiveFrom,
    });
  }
  if (values.length === 0) {
    return { ok: false, why: "The interest rates table has no year rows." };
  }

  const last = values[values.length - 1]!;
  const year = last.effectiveFrom!.getUTCFullYear();
  const row = lines.find((line) => tableCells(line)[0] === String(year)) ?? "";
  return { ok: true, values, evidence: `${HEADING}\n${row}`.slice(0, 1000) };
}
