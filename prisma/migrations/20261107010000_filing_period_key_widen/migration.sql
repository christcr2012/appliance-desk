-- CMP-3: Form 8300 filings key their period by the triggering receipt
-- ("8300-" + the receipt's id), which is longer than the 20 characters
-- CMP-1 allowed for period keys. Widen the column; every existing value
-- still fits.
ALTER TABLE "ComplianceFiling" ALTER COLUMN "periodKey" TYPE VARCHAR(40);
