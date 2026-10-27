import { businessDateFromKey } from "@/lib/business-date";
import {
  pageToLines,
  parseMoneyTenThousandths,
  tableCells,
  type ParseResult,
  type ParsedRuleValue,
} from "./index";

/**
 * Colorado retail delivery fee rates (tax.colorado.gov/retail-delivery-fee-rates).
 * The page's rates table has one column per July-to-June year and seven
 * rows: the six named parts and the stated total. Strict: the header row,
 * all six parts and the total must be present for a column, every amount
 * must parse, and the six parts must add up to the stated total exactly —
 * otherwise the whole parse fails rather than trusting one column.
 * Verified against the live page on 2026-10-26: July 2026 to June 2027
 * parts 0.0792 + 0.0609 + 0.0344 + 0.0965 + 0.0310 + 0.0080 = 0.3100 and
 * the stated total $0.31.
 */

const PART_NAMES = [
  "Community Access Retail Delivery Fee",
  "Clean Fleet Retail Delivery Fee",
  "Clean Transit Retail Delivery Fee",
  "General Retail Delivery Fee",
  "Bridge and Tunnel Retail Delivery Fee",
  "Air Pollution Mitigation Retail Delivery Fee",
] as const;

const TOTAL_NAME = "Total Retail Delivery Fee";

function rowValues(lines: string[], name: string, columns: number): number[] | null {
  const line = lines.find((candidate) => candidate.startsWith(name));
  if (!line) return null;
  const cells = tableCells(line);
  if (cells.length !== columns + 1 || cells[0] !== name) return null;
  const values: number[] = [];
  for (const cell of cells.slice(1)) {
    const parsed = parseMoneyTenThousandths(cell.replace(/\*/g, "").trim());
    if (parsed === null) return null;
    values.push(parsed);
  }
  return values;
}

export function parseRdfRates(pageText: string): ParseResult {
  const lines = pageToLines(pageText);
  const header = lines.find((line) => line.startsWith("Fee Type"));
  if (!header) return { ok: false, why: "The rates table heading was not found." };

  const years: number[] = [];
  const yearPattern = /July (\d{4}) [Tt]o June (\d{4})/g;
  let match: RegExpExecArray | null;
  while ((match = yearPattern.exec(header)) !== null) {
    const startYear = Number(match[1]);
    if (Number(match[2]) !== startYear + 1) {
      return { ok: false, why: "A rates table column does not run July to the next June." };
    }
    years.push(startYear);
  }
  if (years.length === 0) {
    return { ok: false, why: "The rates table has no July-to-June columns." };
  }

  const parts: number[][] = [];
  for (const name of PART_NAMES) {
    const values = rowValues(lines, name, years.length);
    if (values === null) {
      return { ok: false, why: `The "${name}" row is missing or does not parse.` };
    }
    parts.push(values);
  }
  const totals = rowValues(lines, TOTAL_NAME, years.length);
  if (totals === null) {
    return { ok: false, why: "The total row is missing or does not parse." };
  }

  const values: ParsedRuleValue[] = [];
  for (let column = 0; column < years.length; column += 1) {
    const sum = parts.reduce((total, row) => total + row[column]!, 0);
    if (sum !== totals[column]) {
      return {
        ok: false,
        why: `The six parts for July ${years[column]} do not add up to the stated total.`,
      };
    }
    if (sum % 100 !== 0) {
      return { ok: false, why: "The total fee is not a whole number of cents." };
    }
    const effectiveFrom = businessDateFromKey(`${years[column]}-07-01`);
    if (!effectiveFrom) return { ok: false, why: "A column year does not parse." };
    values.push({
      ruleKey: "co.rdf.amount",
      value: sum / 100,
      effectiveFrom,
    });
  }

  const totalLine = lines.find((line) => line.startsWith(TOTAL_NAME)) ?? "";
  return {
    ok: true,
    values,
    evidence: `${header}\n${totalLine}`.slice(0, 1000),
  };
}
