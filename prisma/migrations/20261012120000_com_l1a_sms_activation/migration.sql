-- COM-L1a: Customer SMS is independently disabled until owner activates it.
ALTER TABLE "BusinessSettings"
  ADD COLUMN "customerSmsEnabled" BOOLEAN NOT NULL DEFAULT false;
