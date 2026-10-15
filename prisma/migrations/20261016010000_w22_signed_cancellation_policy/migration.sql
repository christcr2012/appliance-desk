-- Add-only: preserve old signed obligations without inventing a retroactive policy.
ALTER TABLE "AgreementSigningPayment"
  ADD COLUMN "cancellationPolicyEvidence" JSONB;
ALTER TABLE "PreDeliveryCancellation"
  ADD COLUMN "signedPolicyEvidence" JSONB;

-- Once stored at signing, the policy evidence may not be rewritten by a
-- settings update, provider callback, retry, refund, or administrative edit.
CREATE OR REPLACE FUNCTION "w22_guard_signed_cancellation_policy"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."cancellationPolicyEvidence" IS DISTINCT FROM NEW."cancellationPolicyEvidence" THEN
    RAISE EXCEPTION 'Signed cancellation evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "w22_signed_cancellation_policy_immutable"
  BEFORE UPDATE ON "AgreementSigningPayment"
  FOR EACH ROW EXECUTE FUNCTION "w22_guard_signed_cancellation_policy"();

-- An approved cancellation must cite the SAME signed policy as the obligation.
-- No admin panel, webhook or refund-return path may replace it later.
CREATE OR REPLACE FUNCTION "w22_guard_cancel_approval_policy"()
RETURNS TRIGGER AS $$
DECLARE expected JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "cancellationPolicyEvidence" INTO expected
      FROM "AgreementSigningPayment"
      WHERE "agreementId" = NEW."agreementId";
    IF NEW."signedPolicyEvidence" IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Cancellation approval disagrees with signed policy';
    END IF;
  ELSIF OLD."signedPolicyEvidence" IS DISTINCT FROM NEW."signedPolicyEvidence" THEN
    RAISE EXCEPTION 'Approved cancellation policy evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "w22_cancellation_approval_policy_guard"
  BEFORE INSERT OR UPDATE ON "PreDeliveryCancellation"
  FOR EACH ROW EXECUTE FUNCTION "w22_guard_cancel_approval_policy"();
