-- Additive (Batch ACC, ACC-1). A team member's own phone number (for sign-in codes later) and when it was confirmed.
-- Both start empty; nothing reads them until a person saves one on "My account".
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneConfirmedAt" TIMESTAMP(3);
