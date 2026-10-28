-- TAXBEN-1 S5: the two remaining benefit-engine rules — the self-employment
-- tax rates (the deduction share and wage base already live in us.se_tax)
-- and the mid-quarter convention threshold. Sources:
-- docs/research/2026-10-25-tax-benefits.md.
INSERT INTO "LegalRuleVersion"
  ("id", "ruleKey", "value", "effectiveFrom", "origin", "sourceUrl", "sourceQuote",
   "checkedOn", "provisional", "autoApplied", "undoneAt", "createdByUserId", "createdAt")
VALUES
  ('rule-us-se-tax-rates-20260101', 'us.se_tax_rates', '{"netEarningsPercent":92.35,"socialSecurityPercent":12.4,"medicarePercent":2.9,"minimumNetEarningsCents":40000}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/taxtopics/tc554', 'Self-employment tax: 12.4% Social Security up to the wage base plus 2.9% Medicare, on 92.35% of net earnings; applies at $400 or more of net earnings (26 U.S.C. 1401-1402)',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now()),
  ('rule-us-mid-quarter-20260101', 'us.mid_quarter', '{"percent":40}', '2026-01-01T07:00:00Z', 'RESEARCHED',
   'https://www.irs.gov/publications/p946', 'Mid-quarter convention applies when more than 40% of the year''s depreciable basis is placed in service in the last three months (26 U.S.C. 168(d)(3))',
   '2026-10-25T12:00:00Z', true, false, NULL, NULL, now());
