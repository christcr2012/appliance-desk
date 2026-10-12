-- W-22 settled down-payment entitlement, not an invoice application.
CREATE TABLE "SigningDownPaymentCredit" (
 "agreementId" TEXT PRIMARY KEY NOT NULL,
 "receiptId" TEXT NOT NULL UNIQUE,
 "orderFingerprint" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SigningDownPaymentCredit_valid" CHECK ("amountCents" > 0 AND "orderFingerprint" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "SigningDownPaymentCredit_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "AgreementSigningPayment"("agreementId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SigningDownPaymentCredit_rentalAgreement_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SigningDownPaymentCredit_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION verify_signing_down_payment_entitlement() RETURNS TRIGGER AS $$
BEGIN
 PERFORM 1 FROM "AgreementSigningPayment" p
 JOIN "RentalAgreement" a ON a."id" = p."agreementId"
 JOIN "Receipt" r ON r."id" = p."receiptId"
 WHERE p."agreementId" = NEW."agreementId"
 AND p."status" = 'SETTLED' AND p."receiptId" = NEW."receiptId"
 AND p."orderFingerprint" = NEW."orderFingerprint"
 AND p."downPaymentCents" = NEW."amountCents"
 AND p."totalCents" = r."amountCents" AND a."customerId" = r."customerId";
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Signing entitlement requires exact settled agreement receipt' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SigningDownPaymentCredit_verified_insert"
 BEFORE INSERT ON "SigningDownPaymentCredit" FOR EACH ROW
 EXECUTE FUNCTION verify_signing_down_payment_entitlement();
CREATE FUNCTION reject_signing_entitlement_mutation() RETURNS TRIGGER AS $$
BEGIN
 RAISE EXCEPTION 'Signing down-payment entitlements are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SigningDownPaymentCredit_immutable"
 BEFORE UPDATE OR DELETE ON "SigningDownPaymentCredit" FOR EACH ROW
 EXECUTE FUNCTION reject_signing_entitlement_mutation();
-- Existing SETTLED source evidence cannot be relabeled after minting a credit.
CREATE FUNCTION protect_signing_entitlement_sources() RETURNS TRIGGER AS $$
BEGIN
 IF TG_TABLE_NAME = 'AgreementSigningPayment' THEN
  IF EXISTS (SELECT 1 FROM "SigningDownPaymentCredit" WHERE "agreementId" = OLD."agreementId")
    AND (NEW."receiptId" IS DISTINCT FROM OLD."receiptId"
     OR NEW."orderFingerprint" IS DISTINCT FROM OLD."orderFingerprint"
     OR NEW."downPaymentCents" IS DISTINCT FROM OLD."downPaymentCents"
     OR NEW."setupFeeCents" IS DISTINCT FROM OLD."setupFeeCents"
     OR NEW."setupTaxCents" IS DISTINCT FROM OLD."setupTaxCents"
     OR NEW."evidenceVersion" IS DISTINCT FROM OLD."evidenceVersion"
     OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
     OR NEW."totalCents" IS DISTINCT FROM OLD."totalCents"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."settledAt" IS DISTINCT FROM OLD."settledAt") THEN
   RAISE EXCEPTION 'Settled signing credit source cannot be changed' USING ERRCODE = '23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SigningPayment_protect_credit_source"
 BEFORE UPDATE ON "AgreementSigningPayment" FOR EACH ROW
 EXECUTE FUNCTION protect_signing_entitlement_sources();
CREATE FUNCTION protect_signing_credit_receipt() RETURNS TRIGGER AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "SigningDownPaymentCredit" WHERE "receiptId" = OLD."id")
  AND (NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
   OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
   OR NEW."source" IS DISTINCT FROM OLD."source"
   OR NEW."method" IS DISTINCT FROM OLD."method"
   OR NEW."recordedByUserId" IS DISTINCT FROM OLD."recordedByUserId"
   OR NEW."stripeChargeId" IS DISTINCT FROM OLD."stripeChargeId"
   OR NEW."receivedOn" IS DISTINCT FROM OLD."receivedOn") THEN
  RAISE EXCEPTION 'Settled signing credit receipt cannot be changed' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Receipt_protect_signing_credit_source"
 BEFORE UPDATE ON "Receipt" FOR EACH ROW
 EXECUTE FUNCTION protect_signing_credit_receipt();
