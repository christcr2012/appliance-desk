import type { RuleKey } from "../registry";
import { parseCoInterest } from "./co-interest";
import { parseGreeleyRate } from "./greeley-rate";
import { parseIrs1099Threshold } from "./irs-1099-threshold";
import { parseRdfRates } from "./rdf-rates";

/**
 * TFA-3 (spec section 13): strict parsers for the official pages the desk
 * watches. A parser is a pure function of the page text the safe fetch
 * returns (raw HTML, whitespace-normalized per line). It either finds the
 * exact table or heading it expects, with every number parsing and every
 * date explicit, or it returns ok:false ("couldn't read") — never a guess.
 * A value is only ever stored as an observation; the owner approves it on
 * To do before it can become a rule version.
 */

export type ParsedRuleValue = {
  ruleKey: RuleKey;
  value: unknown;
  effectiveFrom: Date | null;
};

export type ParseResult =
  | { ok: true; values: ParsedRuleValue[]; evidence: string }
  | { ok: false; why: string };

export type RuleParser = (pageText: string) => ParseResult;

export const PARSER_KEYS = [
  "RDF_RATES",
  "GREELEY_RATE",
  "IRS_1099_THRESHOLD",
  "CO_INTEREST",
] as const;

export type ParserKey = (typeof PARSER_KEYS)[number];

export function isParserKey(value: string | null): value is ParserKey {
  return value !== null && (PARSER_KEYS as readonly string[]).includes(value);
}

const PARSERS: Record<ParserKey, RuleParser> = {
  RDF_RATES: parseRdfRates,
  GREELEY_RATE: parseGreeleyRate,
  IRS_1099_THRESHOLD: parseIrs1099Threshold,
  CO_INTEREST: parseCoInterest,
};

export function parserForKey(parserKey: string | null): RuleParser | null {
  return isParserKey(parserKey) ? PARSERS[parserKey] : null;
}

/**
 * Turn fetched page text (raw HTML) into readable lines: table cells are
 * joined with " | ", rows and list items become lines, tags are stripped
 * and the common entities decoded. Parsers anchor on the visible text, so
 * a page whose layout changes under the same words still parses, while a
 * page that stops stating the number fails strict.
 */
export function pageToLines(pageText: string): string[] {
  const withBreaks = pageText
    .replace(/<\/(?:td|th)>/gi, " | ")
    .replace(/<\/(?:tr|li|p|h1|h2|h3|h4|h5|div|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]*>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0?39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  return decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

export function pageToText(pageText: string): string {
  return pageToLines(pageText).join("\n");
}

/** Split a table line into trimmed cells, dropping empty edge cells. */
export function tableCells(line: string): string[] {
  const cells = line.split("|").map((cell) => cell.trim());
  while (cells.length > 0 && cells[0] === "") cells.shift();
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * Parse a dollar amount like "$0.0792" or "$2,000" into integer
 * ten-thousandths of a dollar, with string math only (no float drift).
 * Returns null when the text is not exactly that shape.
 */
export function parseMoneyTenThousandths(raw: string): number | null {
  const match = /^\$?([\d,]+)(?:\.(\d{1,4}))?$/.exec(raw.trim());
  if (!match) return null;
  const dollars = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isSafeInteger(dollars)) return null;
  const fraction = (match[2] ?? "").padEnd(4, "0");
  return dollars * 10000 + Number(fraction);
}
