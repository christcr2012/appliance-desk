-- Immutable provider invoice-line evidence for the W-22 first-rent prepayment.
CREATE TABLE "SigningFirstInvoiceApplication" (
 "agreementId" TEXT PRIMARY KEY NOT NULL,
 "stripeSubscriptionId" TEXT NOT NULL UNIQUE,
 "stripeInvoiceId" TEXT NOT NULL UNIQUE,
 "stripeInvoiceLineId" TEXT NOT NULL UNIQUE,
 "orderFingerprint" TEXT NOT NULL,
 "receiptId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL,
 "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SigningFirstInvoiceApplication_check" CHECK (
   "amountCents" > 0 AND "orderFingerprint" ~ '^[0-9a-f]{64}$'
   AND "stripeSubscriptionId" LIKE 'sub_%' AND "stripeInvoiceId" LIKE 'in_%'
 ),
 CONSTRAINT "SigningFirstInvoiceApplication_entitlement_fkey"
   FOREIGN KEY ("agreementId") REFERENCES "SigningDownPaymentCredit"("agreementId") ON DELETE RESTRICT,
 CONSTRAINT "SigningFirstInvoiceApplication_agreement_fkey"
   FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT
);
CREATE FUNCTION verify_signing_first_invoice_application() RETURNS TRIGGER AS $$
BEGIN
 PERFORM 1 FROM "SigningDownPaymentCredit" c
 JOIN "AgreementSigningPayment" p ON p."agreementId" = c."agreementId"
 JOIN "RentalAgreement" a ON a."id" = c."agreementId"
 WHERE c."agreementId" = NEW."agreementId"
 AND c."receiptId" = NEW."receiptId" AND c."amountCents" = NEW."amountCents"
 AND c."orderFingerprint" = NEW."orderFingerprint"
 AND p."status" = 'SETTLED' AND p."receiptId" = NEW."receiptId"
 AND a."stripeSubscriptionId" = NEW."stripeSubscriptionId";
 IF NOT FOUND THEN
  RAISE EXCEPTION 'First invoice credit must match settled frozen agreement' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SigningFirstInvoiceApplication_verified"
 BEFORE INSERT ON "SigningFirstInvoiceApplication" FOR EACH ROW
 EXECUTE FUNCTION verify_signing_first_invoice_application();
CREATE TRIGGER "SigningFirstInvoiceApplication_immutable"
 BEFORE UPDATE OR DELETE ON "SigningFirstInvoiceApplication" FOR EACH ROW
 EXECUTE FUNCTION reject_signing_entitlement_mutation();
