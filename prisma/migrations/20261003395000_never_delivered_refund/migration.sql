-- Batch C section 8: an item that never arrives is refunded (not turned into account credit). The waiting item keeps
-- how much went back to the customer's card or bank through Stripe, and how much the owner pays back by hand.
ALTER TABLE "PendingDelivery" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PendingDelivery" ADD COLUMN "refundByHandCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PendingDelivery" ADD CONSTRAINT "PendingDelivery_refund_amounts_check" CHECK ("refundedCents" >= 0 AND "refundByHandCents" >= 0);
