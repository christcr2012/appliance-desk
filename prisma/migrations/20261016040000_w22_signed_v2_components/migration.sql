-- W-22FIN V2 obligation schema; preserve all historical V1 rows.
ALTER TABLE "AgreementSigningPayment" ADD COLUMN "componentEvidence" JSONB;
CREATE OR REPLACE FUNCTION "w22_v2_due"(
  evidence JSONB, agreement TEXT, setup BIGINT, setup_tax BIGINT,
  advance BIGINT, total BIGINT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c JSONB; t JSONB; due BIGINT:=0; setup_amount BIGINT:=NULL;
  advance_amount BIGINT:=NULL; setup_tax_amount BIGINT:=0;
  kinds TEXT[]:=ARRAY[]::TEXT[]; tax_keys TEXT[]:=ARRAY[]::TEXT[];
  category TEXT; tax_key TEXT; n BIGINT;
BEGIN
 IF jsonb_typeof(evidence) IS DISTINCT FROM 'object' OR
    jsonb_typeof(evidence->'components') IS DISTINCT FROM 'array' OR
    jsonb_typeof(evidence->'taxLines') IS DISTINCT FROM 'array' OR
    jsonb_array_length(evidence->'components') <> 8 OR
    jsonb_array_length(evidence->'taxLines') > 1000 THEN RETURN FALSE; END IF;
 IF jsonb_typeof(evidence->'ownerPolicyRevision') IS DISTINCT FROM 'number' OR
    (evidence->>'ownerPolicyRevision')::NUMERIC < 1 OR
    (evidence->>'ownerPolicyRevision')::NUMERIC <> trunc((evidence->>'ownerPolicyRevision')::NUMERIC) OR
    jsonb_typeof(evidence->'mandatoryReviewRevision') IS DISTINCT FROM 'number' OR
    (evidence->>'mandatoryReviewRevision')::NUMERIC < 1 OR
    (evidence->>'mandatoryReviewRevision')::NUMERIC <> trunc((evidence->>'mandatoryReviewRevision')::NUMERIC) OR
    COALESCE(evidence->>'mandatoryReviewFingerprint','') !~ '^[0-9a-f]{64}$'
    THEN RETURN FALSE; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(evidence->'components') LOOP
   category:=c->>'category';
   IF category IS NULL OR category = ANY(kinds) OR
      category <> ALL(ARRAY['ADMINISTRATIVE_SETUP','DELIVERY',
        'INSTALLATION','REMOVAL','DAMAGE_WAIVER','FIRST_MONTH_RENT_ADVANCE',
        'COMMERCIAL_RESERVE','RETAIL_DELIVERY_FEE']) OR
      c->>'id' IS DISTINCT FROM agreement||':'||category OR
      jsonb_typeof(c->'amountCents') IS DISTINCT FROM 'number' OR
      c->>'disposition' IS NULL OR
      c->>'disposition' NOT IN ('DUE_NOW','NOT_APPLICABLE','BUSINESS_PAID') THEN
     RETURN FALSE; END IF;
   IF COALESCE(c->>'sourceFingerprint','') !~ '^[0-9a-f]{64}$' OR
      jsonb_typeof(c->'sourceRevision') IS DISTINCT FROM 'number' OR
      (c->>'sourceRevision')::NUMERIC < 1 OR
      (c->>'sourceRevision')::NUMERIC <> trunc((c->>'sourceRevision')::NUMERIC) OR
      (category='COMMERCIAL_RESERVE' AND c->>'disposition'='BUSINESS_PAID')
      THEN RETURN FALSE; END IF;
   kinds:=array_append(kinds,category);
   IF (c->>'amountCents')::NUMERIC <> trunc((c->>'amountCents')::NUMERIC)
      THEN RETURN FALSE; END IF;
   n:=(c->>'amountCents')::BIGINT;
   IF n<0 OR n>100000000000 THEN RETURN FALSE; END IF;
   IF c->>'disposition'='DUE_NOW' THEN due:=due+n;
   ELSIF n<>0 THEN RETURN FALSE; END IF;
   IF category='COMMERCIAL_RESERVE' AND n>0 AND (
      jsonb_typeof(evidence->'reserveTermsRevision') IS DISTINCT FROM 'number' OR
      (evidence->>'reserveTermsRevision')::NUMERIC < 1 OR
      (evidence->>'reserveTermsRevision')::NUMERIC <> trunc((evidence->>'reserveTermsRevision')::NUMERIC) OR
      c->>'sourceRevision' IS DISTINCT FROM evidence->>'reserveTermsRevision' OR
      c->>'termsReference' IS DISTINCT FROM evidence->>'reserveTermsReference' OR
      length(trim(COALESCE(c->>'termsReference',''))) < 12
   ) THEN RETURN FALSE; END IF;
   IF category='ADMINISTRATIVE_SETUP' THEN setup_amount:=n; END IF;
   IF category='FIRST_MONTH_RENT_ADVANCE' THEN advance_amount:=n; END IF;
 END LOOP;
 FOR t IN SELECT value FROM jsonb_array_elements(evidence->'taxLines') LOOP
   tax_key:=concat_ws('|',t->>'componentId',t->>'category',
     t->>'jurisdictionId',t->>'rateVersionId');
   IF jsonb_typeof(t->'taxCents') IS DISTINCT FROM 'number' OR
      jsonb_typeof(t->'taxableCents') IS DISTINCT FROM 'number' OR
      jsonb_typeof(t->'exemptCents') IS DISTINCT FROM 'number' OR
      t->>'componentId' IS NULL OR
      t->>'category' IS NULL OR
      COALESCE(t->>'jurisdictionId','') = '' OR COALESCE(t->>'rateVersionId','') = '' OR
      (t->>'taxableCents')::NUMERIC < 0 OR (t->>'exemptCents')::NUMERIC < 0 OR
      (t->>'taxableCents')::NUMERIC <> trunc((t->>'taxableCents')::NUMERIC) OR
      (t->>'exemptCents')::NUMERIC <> trunc((t->>'exemptCents')::NUMERIC) OR
      tax_key = ANY(tax_keys) OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'components') AS component
        WHERE component->>'id'=t->>'componentId'
          AND component->>'disposition'='DUE_NOW'
          AND t->>'category'=CASE component->>'category'
            WHEN 'FIRST_MONTH_RENT_ADVANCE' THEN 'RENTAL'
            WHEN 'COMMERCIAL_RESERVE' THEN NULL
            WHEN 'RETAIL_DELIVERY_FEE' THEN NULL
            ELSE component->>'category' END
          AND ((t->>'taxableCents')::NUMERIC+(t->>'exemptCents')::NUMERIC)
              =(component->>'amountCents')::NUMERIC) THEN RETURN FALSE; END IF;
   tax_keys:=array_append(tax_keys,tax_key);
   IF (t->>'taxCents')::NUMERIC <> trunc((t->>'taxCents')::NUMERIC)
      THEN RETURN FALSE; END IF;
   n:=(t->>'taxCents')::BIGINT;
   IF n<0 OR n>100000000000 THEN RETURN FALSE; END IF;
   due:=due+n;
   IF t->>'componentId'=agreement||':ADMINISTRATIVE_SETUP' THEN
      setup_tax_amount:=setup_tax_amount+n;
   END IF;
 END LOOP;
 RETURN COALESCE(due=total AND setup_amount=setup AND
   advance_amount=advance AND setup_tax_amount=setup_tax AND
   due>=0 AND due<=2147483647,FALSE);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$$;

ALTER TABLE "AgreementSigningPayment"
  DROP CONSTRAINT "AgreementSigningPayment_frozen_amounts_check";
ALTER TABLE "AgreementSigningPayment"
  ADD CONSTRAINT "AgreementSigningPayment_frozen_amounts_check" CHECK (
    "orderFingerprint" ~ '^[0-9a-f]{64}$'
    AND "setupFeeCents" >= 0 AND "setupTaxCents" >= 0
    AND "downPaymentCents" >= 0 AND "totalCents" >= 0
    AND (
      ("evidenceVersion" = 1 AND "componentEvidence" IS NULL AND
        "totalCents"::BIGINT = "setupFeeCents"::BIGINT +
        "setupTaxCents"::BIGINT + "downPaymentCents"::BIGINT)
      OR
      ("evidenceVersion" = 2 AND "componentEvidence" IS NOT NULL AND
        "w22_v2_due"("componentEvidence","agreementId",
          "setupFeeCents","setupTaxCents","downPaymentCents","totalCents"))
    )
    AND (
      ("totalCents" = 0 AND "status" = 'NOT_DUE' AND
        "receiptId" IS NULL AND "settledAt" IS NULL)
      OR
      ("totalCents" > 0 AND "status" = 'AWAITING_PAYMENT' AND
        "receiptId" IS NULL AND "settledAt" IS NULL)
      OR
      ("totalCents" > 0 AND "status" = 'SETTLED' AND
        "receiptId" IS NOT NULL AND "settledAt" IS NOT NULL)
    )
  );
CREATE FUNCTION "w22_immutable_v2_components"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."componentEvidence" IS DISTINCT FROM NEW."componentEvidence" THEN
    RAISE EXCEPTION 'Frozen signing component evidence cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w22_immutable_v2_components"
  BEFORE UPDATE ON "AgreementSigningPayment"
  FOR EACH ROW EXECUTE FUNCTION "w22_immutable_v2_components"();

-- Retain historical null signatures and exact V1 meaning; explicitly permit V2.
ALTER TABLE "SignatureRecord" DROP CONSTRAINT "SignatureRecord_signing_evidence_complete";
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_signing_evidence_complete" CHECK (
 ("signingOrderFingerprint" IS NULL AND "signingAllInCents" IS NULL AND "signingEvidenceVersion" IS NULL)
 OR ("signingOrderFingerprint" IS NOT NULL AND "signingOrderFingerprint" ~ '^[0-9a-f]{64}$'
  AND "signingAllInCents" IS NOT NULL AND "signingAllInCents">=0
  AND "signingEvidenceVersion" IS NOT NULL AND "signingEvidenceVersion" IN (1,2))
);
-- New V2 obligations must use the exact accepted signature and frozen components.
-- Historical V1 fixture/legacy semantics remain unchanged.
CREATE FUNCTION "w22_v2_signed_source"() RETURNS TRIGGER AS $$
BEGIN
 IF NEW."evidenceVersion"=2 AND NOT EXISTS (
  SELECT 1 FROM "SignatureRecord" s JOIN "AgreementSigningCharge" c ON c."agreementId"=s."agreementId"
  WHERE s."agreementId"=NEW."agreementId" AND s."signedAt"=NEW."signedAt"
   AND s."signingEvidenceVersion"=2 AND s."signingOrderFingerprint"=NEW."orderFingerprint"
   AND s."signingAllInCents"=NEW."totalCents"
   AND c."frozenOrderFingerprint"=NEW."orderFingerprint" AND c."frozenAllInCents"=NEW."totalCents"
   AND c."setupFeeCents"=NEW."setupFeeCents" AND c."downPaymentCents"=NEW."downPaymentCents"
   AND c."frozenSetupTaxCents"=NEW."setupTaxCents"
   AND c."frozenChargeEvidence"->>'schemaVersion'='2'
   AND c."frozenChargeEvidence"->'v2Extension'=NEW."componentEvidence"
 ) THEN RAISE EXCEPTION 'V2 payment requires exact signed frozen source evidence'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "w22_v2_signed_source" BEFORE INSERT OR UPDATE ON "AgreementSigningPayment"
FOR EACH ROW EXECUTE FUNCTION "w22_v2_signed_source"();
