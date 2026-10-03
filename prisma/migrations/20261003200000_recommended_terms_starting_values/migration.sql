-- Starting values for "Ending and renewing rentals" (owner decision IN-19: use common
-- practice, keep everything editable). Written ONCE, and only when the owner has not
-- entered any of these settings yet, so nothing the owner typed is ever overwritten.
-- Every value stays editable in Settings. The wording is plain English with no number
-- the owner can change in it. The auto-renew version label is computed the same way the
-- app does it (ar- plus the first 10 characters of a SHA-256 of the notice days and the
-- wording as JSON); tests/recommended-terms-integration.test.ts proves they agree.
UPDATE "BusinessSettings"
SET
  "earlyTerminationFeeCents" = 5000,
  "earlyTerminationFeePercent" = 25,
  "earlyTerminationFeeCapCents" = 20000,
  "earlyTerminationNoticeDays" = 30,
  "unusedTermTreatment" = 'REFUND',
  "terminationTermsText" = 'You can end this agreement early by giving us the notice shown above. The agreement then ends on your next monthly billing date after the notice period, and rent stops on that date. The early-ending fee shown above is due when you end early. We will arrange to pick up the appliances from your address, and you agree to let us in and to keep them in the same condition, apart from normal wear and tear.',
  "autoRenewNoticeDays" = 30,
  "renewalTermsText" = 'If you turn on automatic renewal, then when your fixed term ends your rental continues month to month at the same monthly rent, and you keep being billed each month. We will remind you before your term ends and tell you your rent. You can turn automatic renewal off for free, online or by contacting us, as long as you do it within the notice shown above. If you do, the agreement simply ends on its end date. Once renewed, you can end the month-to-month rental by giving the same notice.',
  "autoRenewTermsVersion" = 'ar-' || substr(encode(sha256(convert_to('[30,' || to_json('If you turn on automatic renewal, then when your fixed term ends your rental continues month to month at the same monthly rent, and you keep being billed each month. We will remind you before your term ends and tell you your rent. You can turn automatic renewal off for free, online or by contacting us, as long as you do it within the notice shown above. If you do, the agreement simply ends on its end date. Once renewed, you can end the month-to-month rental by giving the same notice.'::text)::text || ']', 'UTF8')), 'hex'), 1, 10)
WHERE "id" = 'singleton'
  AND "earlyTerminationFeeCents" IS NULL
  AND "earlyTerminationFeePercent" IS NULL
  AND "earlyTerminationFeeCapCents" IS NULL
  AND "earlyTerminationNoticeDays" IS NULL
  AND "unusedTermTreatment" IS NULL
  AND "terminationTermsText" IS NULL
  AND "autoRenewNoticeDays" IS NULL
  AND "renewalTermsText" IS NULL
  AND "autoRenewTermsVersion" IS NULL;
