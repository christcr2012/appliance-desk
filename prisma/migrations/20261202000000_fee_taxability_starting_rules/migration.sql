-- FEETAX-1 S3: starting answers for optional, separately stated service lines
-- (spec FEE-TAXABILITY section 4), seeded as "Researched — not confirmed"
-- (provisional) with their research sources. Only the NEW optional-separate
-- answer is written: a blank on an existing cell is filled, a recorded answer
-- is never overwritten, and a missing cell is created with its regular answer
-- still UNDECIDED (the regular answers belong to Decisions & reviews).
-- Greeley gets NO seeded answer: its service fees stay taxed until Greeley
-- confirms in writing (card acceptance). State-collected towns follow the
-- state (null-jurisdiction) answers, so they need no rows of their own.

UPDATE "TaxabilityRule" SET "optionalSeparatedTreatment" = 'EXEMPT'
WHERE "jurisdictionId" IS NULL AND "category" = 'DELIVERY' AND "optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-state-delivery', NULL, 'DELIVERY', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "Colorado Sales Tax Guide (May 2026), p. 9 \u2014 separable, separately stated delivery and installation", "url": "https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf", "checkedOn": "2026-10-25"}, {"title": "GIL 18-003 \u2014 separately stated delivery and installation charges", "url": "https://tax.colorado.gov/sites/default/files/documents/GIL-18-003.pdf", "checkedOn": "2026-10-25"}, {"title": "FEETAX-1 research notes", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TaxabilityRule" WHERE "jurisdictionId" IS NULL AND "category" = 'DELIVERY');

UPDATE "TaxabilityRule" SET "optionalSeparatedTreatment" = 'EXEMPT'
WHERE "jurisdictionId" IS NULL AND "category" = 'INSTALLATION' AND "optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-state-installation', NULL, 'INSTALLATION', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "Colorado Sales Tax Guide (May 2026), p. 9 \u2014 separable, separately stated delivery and installation", "url": "https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf", "checkedOn": "2026-10-25"}, {"title": "GIL 18-003 \u2014 separately stated delivery and installation charges", "url": "https://tax.colorado.gov/sites/default/files/documents/GIL-18-003.pdf", "checkedOn": "2026-10-25"}, {"title": "FEETAX-1 research notes", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TaxabilityRule" WHERE "jurisdictionId" IS NULL AND "category" = 'INSTALLATION');

UPDATE "TaxabilityRule" SET "optionalSeparatedTreatment" = 'EXEMPT'
WHERE "jurisdictionId" IS NULL AND "category" = 'REMOVAL' AND "optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-state-removal', NULL, 'REMOVAL', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "Colorado Sales Tax Guide (May 2026), p. 9 \u2014 separable, separately stated delivery and installation", "url": "https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf", "checkedOn": "2026-10-25"}, {"title": "GIL 18-003 \u2014 separately stated delivery and installation charges", "url": "https://tax.colorado.gov/sites/default/files/documents/GIL-18-003.pdf", "checkedOn": "2026-10-25"}, {"title": "FEETAX-1 research notes", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TaxabilityRule" WHERE "jurisdictionId" IS NULL AND "category" = 'REMOVAL');

UPDATE "TaxabilityRule" SET "optionalSeparatedTreatment" = 'EXEMPT'
WHERE "jurisdictionId" IS NULL AND "category" = 'HAUL_AWAY' AND "optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-state-haul-away', NULL, 'HAUL_AWAY', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "Colorado Sales Tax Guide (May 2026), p. 9 \u2014 separable, separately stated delivery and installation", "url": "https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf", "checkedOn": "2026-10-25"}, {"title": "GIL 18-003 \u2014 separately stated delivery and installation charges", "url": "https://tax.colorado.gov/sites/default/files/documents/GIL-18-003.pdf", "checkedOn": "2026-10-25"}, {"title": "FEETAX-1 research notes", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "TaxabilityRule" WHERE "jurisdictionId" IS NULL AND "category" = 'HAUL_AWAY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'FORT-COLLINS' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-fort-collins-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FORT-COLLINS'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'EXEMPT'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'FORT-COLLINS' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-fort-collins-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'FORT-COLLINS'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'THORNTON' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-thornton-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'THORNTON'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'EXEMPT'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'THORNTON' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-thornton-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'THORNTON'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'BROOMFIELD' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-broomfield-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BROOMFIELD'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'EXEMPT'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'BROOMFIELD' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-broomfield-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'EXEMPT', true, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BROOMFIELD'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'BOULDER' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-boulder-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BOULDER'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'BOULDER' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-boulder-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'BOULDER'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'AURORA' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-aurora-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'AURORA'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'AURORA' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-aurora-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'AURORA'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'WESTMINSTER' AND r."category" = 'DELIVERY' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-westminster-delivery', j."id", 'DELIVERY', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WESTMINSTER'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'DELIVERY');

UPDATE "TaxabilityRule" r SET "optionalSeparatedTreatment" = 'TAXABLE'
FROM "TaxJurisdiction" j
WHERE r."jurisdictionId" = j."id" AND j."code" = 'WESTMINSTER' AND r."category" = 'INSTALLATION' AND r."optionalSeparatedTreatment" IS NULL;
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "optionalSeparatedTreatment", "provisional", "provisionalReason", "provisionalSources", "reason", "updatedAt")
SELECT 'feetax1-sep-westminster-installation', j."id", 'INSTALLATION', 'UNDECIDED', 'TAXABLE', true, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb, 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).', CURRENT_TIMESTAMP
FROM "TaxJurisdiction" j WHERE j."code" = 'WESTMINSTER'
  AND NOT EXISTS (SELECT 1 FROM "TaxabilityRule" r WHERE r."jurisdictionId" = j."id" AND r."category" = 'INSTALLATION');
