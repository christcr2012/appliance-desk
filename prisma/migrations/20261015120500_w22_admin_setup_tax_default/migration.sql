-- W-22C1 step 2 of 2: safe once the new enum value has committed.
-- Explicit undecided policy is NOT CPA approval (IN-79).
INSERT INTO "TaxabilityRule" ("id", "jurisdictionId", "category", "taxability", "updatedAt")
VALUES ('tax-default-administrative-setup', NULL, 'ADMINISTRATIVE_SETUP', 'UNDECIDED', CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
