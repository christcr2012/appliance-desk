-- W-22FIN V2 obligation schema; preserve all historical V1 rows.
ALTER TABLE "AgreementSigningPayment" ADD COLUMN "componentEvidence" JSONB;
CREATE OR REPLACE FUNCTION "w22_v2_due"(
  evidence JSONB, agreement TEXT, setup BIGINT, setup_tax BIGINT,
  advance BIGINT, total BIGINT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c JSONB; t JSONB; due BIGINT:=0; setup_amount BIGINT:=NULL;
  advance_amount BIGINT:=NULL; setup_tax_amount BIGINT:=0;
  kinds TEXT[]:=ARRAY[]::TEXT[]; category TEXT; n BIGINT;
BEGIN
 IF jsonb_typeof(evidence) <> 'object' OR
    jsonb_typeof(evidence->'components') <> 'array' OR
    jsonb_typeof(evidence->'taxLines') <> 'array' OR
    jsonb_array_length(evidence->'components') <> 8 OR
    jsonb_array_length(evidence->'taxLines') > 1000 THEN RETURN FALSE; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(evidence->'components') LOOP
   category:=c->>'category';
   IF category IS NULL OR category = ANY(kinds) OR
      category <> ALL(ARRAY['ADMINISTRATIVE_SETUP','DELIVERY',
        'INSTALLATION','REMOVAL','DAMAGE_WAIVER','FIRST_MONTH_RENT_ADVANCE',
        'COMMERCIAL_RESERVE','RETAIL_DELIVERY_FEE']) OR
      c->>'id' <> agreement||':'||category OR
      jsonb_typeof(c->'amountCents') <> 'number' OR
      c->>'disposition' NOT IN ('DUE_NOW','NOT_APPLICABLE','BUSINESS_PAID') THEN
     RETURN FALSE; END IF;
   kinds:=array_append(kinds,category);
   n:=(c->>'amountCents')::BIGINT;
   IF n<0 OR n>100000000000 THEN RETURN FALSE; END IF;
   IF c->>'disposition'='DUE_NOW' THEN due:=due+n;
   ELSIF n<>0 THEN RETURN FALSE; END IF;
   IF category='ADMINISTRATIVE_SETUP' THEN setup_amount:=n; END IF;
   IF category='FIRST_MONTH_RENT_ADVANCE' THEN advance_amount:=n; END IF;
 END LOOP;
 FOR t IN SELECT value FROM jsonb_array_elements(evidence->'taxLines') LOOP
   IF jsonb_typeof(t->'taxCents') <> 'number' OR
      t->>'componentId' NOT LIKE agreement||':%' OR
      t->>'jurisdictionId' IS NULL OR t->>'rateVersionId' IS NULL THEN
      RETURN FALSE; END IF;
   n:=(t->>'taxCents')::BIGINT;
   IF n<0 OR n>100000000000 THEN RETURN FALSE; END IF;
   due:=due+n;
   IF t->>'componentId'=agreement||':ADMINISTRATIVE_SETUP' THEN
      setup_tax_amount:=setup_tax_amount+n;
   END IF;
 END LOOP;
 RETURN due=total AND setup_amount=setup AND
   advance_amount=advance AND setup_tax_amount=setup_tax AND
   due>=0 AND due<=2147483647;
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
