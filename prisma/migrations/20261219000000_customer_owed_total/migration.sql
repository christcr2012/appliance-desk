-- PB-FIX-1: a maintained per-customer owed total for the customers list.
--
-- Why: the list's owed-desc ordering re-aggregated the whole Invoice table
-- on every call (SUM over every open invoice, grouped by customer). The
-- Performance Baselines investigation (docs/PERF-BASELINES-INVESTIGATION-
-- 2026-10-31.md) measured that aggregate at ~32 ms of the sort's 85 ms
-- database phase at 20,000 customers, and the whole phase at ~175 ms at
-- 40,000 customers — over the 150 ms budget on the fastest hardware
-- measured. A partial covering index was prototyped and rejected: the
-- planner ignores it, because no index shrinks an aggregate that must
-- touch every open invoice.
--
-- What: "Customer"."owedCents" holds SUM(GREATEST(0, amountDue - amountPaid))
-- over the customer's invoices in ('OPEN','PARTIALLY_PAID','DELINQUENT',
-- 'FAILED') — exactly the value the list query used to compute per call.
-- A database trigger keeps it in step inside the writing transaction, so
-- every writer (Prisma, raw SQL, jobs, seeds, future code) maintains it
-- with no application path to miss; CUSTOMERS.md section 1 rejected an
-- application-maintained summary for exactly that missed-write risk.
-- Invoices remain the money source of truth; the column is a sort/display
-- total only. Repair, if drift is ever suspected, is the backfill UPDATE
-- below, re-run on its own.
--
-- Cutover: this migration is one transaction. CREATE TRIGGER takes a
-- SHARE ROW EXCLUSIVE lock on "Invoice" until commit, so a concurrent
-- invoice write either commits before the backfill reads it (counted) or
-- waits and lands after the trigger exists (maintained). No gap and no
-- double count.
ALTER TABLE "Customer" ADD COLUMN "owedCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "Customer" c
SET "owedCents" = COALESCE((
  SELECT SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents"))
  FROM "Invoice" inv
  WHERE inv."customerId" = c."id"
    AND inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
), 0);

CREATE OR REPLACE FUNCTION "maintain_customer_owed_cents"() RETURNS trigger AS $$
DECLARE
  old_contrib integer;
  new_contrib integer;
BEGIN
  old_contrib := CASE WHEN TG_OP <> 'INSERT' AND OLD."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
    THEN GREATEST(0, OLD."amountDueCents" - OLD."amountPaidCents") ELSE 0 END;
  new_contrib := CASE WHEN TG_OP <> 'DELETE' AND NEW."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
    THEN GREATEST(0, NEW."amountDueCents" - NEW."amountPaidCents") ELSE 0 END;
  IF TG_OP = 'UPDATE' AND OLD."customerId" IS DISTINCT FROM NEW."customerId" THEN
    IF old_contrib <> 0 THEN
      UPDATE "Customer" SET "owedCents" = "owedCents" - old_contrib WHERE "id" = OLD."customerId";
    END IF;
    IF new_contrib <> 0 THEN
      UPDATE "Customer" SET "owedCents" = "owedCents" + new_contrib WHERE "id" = NEW."customerId";
    END IF;
  ELSIF new_contrib - old_contrib <> 0 THEN
    UPDATE "Customer"
    SET "owedCents" = "owedCents" + (new_contrib - old_contrib)
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."customerId" ELSE NEW."customerId" END;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_maintain_customer_owed"
  AFTER INSERT OR UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION "maintain_customer_owed_cents"();
