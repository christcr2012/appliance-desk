import { businessDateFromKey } from "@/lib/business-date";
import { pageToLines, type ParseResult } from "./index";

/**
 * City of Greeley sales tax page (greeleyco.gov sales-tax). The parser
 * looks for a sentence that states the city's sales tax rate (the seeded
 * 4.11% came from the city FAQ's worked example). Strict: candidate
 * sentences are the ones that mention both a tax and a rate; every
 * candidate must agree on a single two-decimal percent, or the parse
 * fails. An effective date is returned only when the same sentence
 * states one ("effective January 1, 2027"); otherwise null, and the
 * approval flow cannot schedule the reading until a date is known.
 * Note (2026-10-26): the live page's readable text did not state the
 * rate where this parser could anchor on it, so until the city states
 * the rate in a sentence this parser reads, the watch reports
 * "couldn't read" — the spec's accepted failure mode, never a guess.
 */

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12",
};

function sentencesOf(pageText: string): string[] {
  const joined = pageToLines(pageText).join(" ");
  return joined
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function statedDate(sentence: string): Date | null {
  const match = new RegExp(
    `\\b(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`,
    "i",
  ).exec(sentence);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (!month) return null;
  return businessDateFromKey(
    `${match[3]}-${month}-${match[2]!.padStart(2, "0")}`,
  );
}

export function parseGreeleyRate(pageText: string): ParseResult {
  const candidates = sentencesOf(pageText).filter((sentence) => {
    const lower = sentence.toLowerCase();
    return (lower.includes("tax") && lower.includes("rate") && lower.includes("greeley"))
      || (lower.includes("city") && lower.includes("tax") && lower.includes("rate"));
  });

  const percents = new Map<string, { milliPercent: number; sentence: string }>();
  for (const sentence of candidates) {
    for (const match of sentence.matchAll(/(\d{1,2}\.\d{2})\s*%/g)) {
      percents.set(match[1]!, {
        milliPercent: Math.round(Number(match[1]) * 1000),
        sentence,
      });
    }
  }
  if (percents.size === 0) {
    return { ok: false, why: "No sentence on the page states the city sales tax rate." };
  }
  if (percents.size > 1) {
    return { ok: false, why: "The page states more than one tax rate, so the city rate is not clear." };
  }

  const [{ milliPercent, sentence }] = [...percents.values()];
  return {
    ok: true,
    values: [{
      ruleKey: "greeley.sales_rate",
      value: milliPercent,
      effectiveFrom: statedDate(sentence),
    }],
    evidence: sentence.slice(0, 1000),
  };
}
