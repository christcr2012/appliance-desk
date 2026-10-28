import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// TAXBEN-1 spec, Tests: "Every number read from the rule book (no literals in
// code — a lint test greps the TAXBEN module for dollar literals)." The
// taxben module must read every tax value (limits, percents, month counts)
// from LegalRuleVersion through ruleAsOf or from the system chart. This test
// scans the module's source with comments stripped and fails on:
//   - a dollar amount written into code or a string ("$2,500", "$ 500")
//   - any integer of 4+ digits (cent amounts, wage bases, phase-outs)
//   - the standalone month / square-foot counts the rules own (180, 300)
// Structural numbers under 1000 (a 0..100 percent range check, a string
// length) are not tax values and stay allowed.
const MODULE_DIR = "src/domains/taxben";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("taxben module reads every number from the rule book", () => {
  it("has no dollar literals, 4+ digit integers, or rule-owned counts in src/domains/taxben", () => {
    const files = readdirSync(MODULE_DIR).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(join(MODULE_DIR, file), "utf8"));
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (/\$\s?\d/.test(line)) offenders.push(`${file}:${index + 1}: dollar literal — ${line.trim()}`);
        if (/\b\d{4,}\b/.test(line)) offenders.push(`${file}:${index + 1}: 4+ digit number — ${line.trim()}`);
        if (/\b(180|300)\b/.test(line)) offenders.push(`${file}:${index + 1}: rule-owned count — ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
