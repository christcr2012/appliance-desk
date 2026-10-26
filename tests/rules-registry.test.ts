import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULES, RULE_KEYS, describeRuleValue, type RuleKey } from "@/domains/rules/registry";

// TFA-1 section 5: every registry key is seeded by the migration, every
// schema accepts its seeded value, every seed carries its source, and every
// seeded money value equals the dollar amount in
// docs/research/2026-10-25-tax-fee-rules.md × 100. Runs without a database:
// the seed is checked against the migration text.
const MIGRATION = readFileSync(
  "prisma/migrations/20261101000000_legal_rules/migration.sql", "utf8",
);

// OPS-6 seeds the small-claims rules in its own migration (Colorado Judicial Branch pages, accessed 2026-10-26).
const SMALL_CLAIMS_MIGRATION = readFileSync(
  "prisma/migrations/20261104000000_collections/migration.sql", "utf8",
);

// The seeded value for each key, exactly as the migration inserts it.
const SEEDED: Record<RuleKey, unknown> = {
  "co.rdf.amount": 31,
  "co.rdf.qualified_threshold": 50000000,
  "co.sales.frequency_thresholds": { annualMaxMonthlyCents: 5000, quarterlyMaxMonthlyCents: 110000 },
  "co.sales.state_service_fee": 0,
  "co.use.monthly_threshold": 30000,
  "co.penalty": { minCents: 1500, firstPercent: 10, perMonthPercent: 0.5, maxPercent: 18 },
  "co.interest": { regular: 11, discounted: 8 },
  "co.lease.short_term_months": 36,
  "co.license.expiry": { rule: "DEC_31_ODD_YEARS" },
  "us.1099.threshold": 200000,
  "us.1099.deadlines": { necBoth: "01-31", miscPayee: "01-31", miscIrsPaper: "02-28", miscIrsElectronic: "03-31" },
  "us.section179": { limitCents: 256000000, phaseoutCents: 409000000 },
  "us.bonus_depreciation": { percent: 100, acquiredAfter: "2025-01-19" },
  "records.keep_years": 7,
  "greeley.sales_rate": 4110,
  "co.small_claims_limit": 750000,
  "co.small_claims_filing_limits": { perMonth: 2, perYear: 18 },
  "co.small_claims_fees": { lowMaxCents: 50000, lowFeeCents: 3100, highFeeCents: 5500 },
};

describe("rule registry", () => {
  it("defines every seeded key with a title, explanation, area, schema and edit fields", () => {
    expect(RULE_KEYS).toHaveLength(18);
    for (const key of RULE_KEYS) {
      const def = RULES[key];
      expect(def.key).toBe(key);
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.explain.length).toBeGreaterThan(0);
      expect(def.fields.length).toBeGreaterThan(0);
      for (const field of def.fields) expect(field.label.length).toBeGreaterThan(0);
    }
  });

  it("accepts every seeded value and describes it in plain words", () => {
    for (const key of RULE_KEYS) {
      const def = RULES[key];
      const parsed = def.schema.safeParse(SEEDED[key]);
      expect(parsed.success, `${key} seed must match its schema`).toBe(true);
      expect(describeRuleValue(key, SEEDED[key]).length).toBeGreaterThan(0);
    }
  });

  it("rejects values outside each schema", () => {
    expect(RULES["co.rdf.amount"].schema.safeParse(-1).success).toBe(false);
    expect(RULES["co.rdf.amount"].schema.safeParse(28.5).success).toBe(false);
    expect(RULES["records.keep_years"].schema.safeParse(0).success).toBe(false);
    expect(RULES["records.keep_years"].schema.safeParse(51).success).toBe(false);
    expect(RULES["us.1099.deadlines"].schema.safeParse({
      necBoth: "1-31", miscPayee: "01-31", miscIrsPaper: "02-28", miscIrsElectronic: "03-31",
    }).success).toBe(false);
    expect(RULES["us.section179"].schema.safeParse({ limitCents: 256000000 }).success).toBe(false);
  });

  it("seeds every key in the migration with its researched source and check date", () => {
    for (const key of RULE_KEYS) {
      // Seed rows wrap across lines; split the INSERT into its row tuples.
      const smallClaims = key.startsWith("co.small_claims");
      const source = smallClaims ? SMALL_CLAIMS_MIGRATION : MIGRATION;
      const row = source.split("),\n").find((text) => text.includes(`'${key}'`) && text.includes("'RESEARCHED'"));
      expect(row, `${key} must be seeded`).toBeDefined();
      expect(row).toContain(smallClaims ? "2026-10-26T12:00:00Z" : "2026-10-25T12:00:00Z");
      // A source quote names the document or page the value came from.
      expect(row!.length).toBeGreaterThan(120);
    }
    expect(MIGRATION).toContain("https://tax.colorado.gov/retail-delivery-fee-rates");
    expect(MIGRATION).toContain("https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest");
  });

  it("seeds the RDF amounts by July 1 and the research dollar amounts × 100", () => {
    for (const [date, cents] of [["2023-07-01", 28], ["2024-07-01", 29], ["2025-07-01", 28], ["2026-07-01", 31]] as const) {
      expect(MIGRATION).toContain(`'rule-co-rdf-amount-${date.replaceAll("-", "")}', 'co.rdf.amount', '${cents}'`);
    }
    expect(MIGRATION).toContain("'co.rdf.qualified_threshold', '50000000'"); // $500,000
    expect(MIGRATION).toContain("'co.use.monthly_threshold', '30000'"); // $300
    expect(MIGRATION).toContain("'us.1099.threshold', '200000'"); // $2,000
    expect(MIGRATION).toContain('"limitCents":256000000'); // $2,560,000
    expect(MIGRATION).toContain('"phaseoutCents":409000000'); // $4,090,000
    expect(MIGRATION).toContain("'greeley.sales_rate', '4110'"); // 4.11% (milli-percent, like TaxRateVersion)
  });

  it("copies existing RDF rates into OWNER versions in the migration", () => {
    expect(MIGRATION).toContain("FROM \"RetailDeliveryFeeRate\"");
    expect(MIGRATION).toContain("'OWNER'");
  });

  it("carries the owner's existing settings into OWNER versions in the migration", () => {
    // The readers stop consulting these four settings, so the migration must
    // preserve them as OWNER versions (Codex review on PR #617).
    for (const [column, key] of [
      ["recordRetentionYears", "records.keep_years"],
      ["useTaxMonthlyThresholdCents", "co.use.monthly_threshold"],
      ["rdfThresholdCents", "co.rdf.qualified_threshold"],
      ["vendor1099ThresholdCents", "us.1099.threshold"],
    ] as const) {
      expect(MIGRATION).toContain(`to_jsonb("${column}")`);
      expect(MIGRATION).toContain(`'${key}'`);
    }
    expect(MIGRATION).toContain("FROM \"BusinessSettings\"");
    // Only a value the owner actually changed is carried: the init migration
    // seeds BusinessSettings with the schema defaults, so carrying the
    // defaults would occupy the (ruleKey, effectiveFrom, OWNER) slot and
    // block any later version for the same date.
    for (const [column, def] of [
      ["recordRetentionYears", 7],
      ["useTaxMonthlyThresholdCents", 30000],
      ["rdfThresholdCents", 50000000],
      ["vendor1099ThresholdCents", 200000],
    ] as const) {
      expect(MIGRATION).toContain(`"${column}" <> ${def}`);
    }
  });

  it("lets a READY delivery-fee record cite a rule version, not only a rate row", () => {
    // The old check demanded rateId; the new readers write ruleVersionId with
    // rateId null, so the migration must relax it (PR #617 CI failure).
    expect(MIGRATION).toContain("DROP CONSTRAINT \"RetailDeliveryFeeRecord_ready_requires_evidence\"");
    expect(MIGRATION).toContain("(\"rateId\" IS NOT NULL OR \"ruleVersionId\" IS NOT NULL)");
  });

  it("keeps only one ACTIVE version per rule, date and origin", () => {
    // Undone versions stay as history and must not block a replacement for
    // the same start date (Codex review on PR #617).
    expect(MIGRATION).toContain("LegalRuleVersion_one_active_per_key_date_origin");
    expect(MIGRATION).toContain("WHERE \"undoneAt\" IS NULL");
  });
});
