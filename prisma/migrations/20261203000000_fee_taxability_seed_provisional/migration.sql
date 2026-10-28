-- FEETAX-1: consistency fix for the S3 starting-rule seeds. The seed migration
-- FILLED the optional-separate answer on cells that already existed (the state
-- tax-default rows and any pre-existing city cells) with an UPDATE that set
-- only the new column, leaving those rows provisional = false even though the
-- answer they carry is a researched starting value — while cells the seed
-- INSERTED are provisional = true. The engine labels results from the flag,
-- so every row carrying a seeded optional-separate answer is marked
-- provisional here, with the matching reason and sources where they are
-- missing. Only rows the seed could have touched qualify: the column itself
-- is new in this card, so a non-null value can only have come from the seeds
-- or from a later owner save (an owner save is never provisional-stale: the
-- dated saves clear provisional on the cells they write — and they do not
-- write this column at all in this card).

UPDATE "TaxabilityRule"
SET "provisional" = true,
    "provisionalReason" = COALESCE("provisionalReason", 'Starting value — not confirmed: at the state level, delivery, installation, pickup and haul-away that the customer can decline and that are listed separately are left out of the taxed price (FEETAX-1 research, 2026-10-25).'),
    "provisionalSources" = COALESCE("provisionalSources", '[{"title": "Colorado Sales Tax Guide (May 2026), p. 9 \u2014 separable, separately stated delivery and installation", "url": "https://tax.colorado.gov/sites/default/files/documents/Sales_Tax_Guide_May_2026.pdf", "checkedOn": "2026-10-25"}, {"title": "GIL 18-003 \u2014 separately stated delivery and installation charges", "url": "https://tax.colorado.gov/sites/default/files/documents/GIL-18-003.pdf", "checkedOn": "2026-10-25"}, {"title": "FEETAX-1 research notes", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}]'::jsonb)
WHERE "jurisdictionId" IS NULL AND "optionalSeparatedTreatment" IS NOT NULL AND "provisional" = false;

UPDATE "TaxabilityRule"
SET "provisional" = true,
    "provisionalReason" = COALESCE("provisionalReason",
      CASE
        WHEN "category" = 'INSTALLATION' AND "optionalSeparatedTreatment" = 'EXEMPT'
          THEN 'Starting value — not confirmed: this city leaves separately listed installation out of the taxed price (FEETAX-1 research, 2026-10-25).'
        WHEN "category" = 'DELIVERY'
          THEN 'Starting value — not confirmed: this city taxes delivery even when it is listed separately (FEETAX-1 research, 2026-10-25).'
        ELSE 'Starting value — not confirmed: no verified rule leaves separately listed installation out of the taxed price here, so it stays taxed until confirmed (FEETAX-1 research, 2026-10-25).'
      END),
    "provisionalSources" = COALESCE("provisionalSources", '[{"title": "FEETAX-1 research notes \u2014 verified home-rule city rules", "url": "docs/research/2026-10-25-fee-taxability.md", "checkedOn": "2026-10-25"}, {"title": "50-mile tax jurisdictions research table", "url": "docs/research/2026-10-25-tax-jurisdictions-50mi.md", "checkedOn": "2026-10-25"}]'::jsonb)
WHERE "jurisdictionId" IS NOT NULL AND "optionalSeparatedTreatment" IS NOT NULL AND "provisional" = false;
