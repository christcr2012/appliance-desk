-- W-22C1 step 1 of 2: independently committed enum vocabulary.
-- PostgreSQL will not permit an added enum value to be read in the transaction
-- that created it. The backup restorer explicitly wraps EACH migration in
-- BEGIN/COMMIT, so seeding the default must be a SEPARATE migration.
ALTER TYPE "InvoiceLineItemKind" ADD VALUE 'ADMIN_SETUP_FEE';
ALTER TYPE "TaxChargeCategory" ADD VALUE 'ADMINISTRATIVE_SETUP';
