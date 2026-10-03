-- An early-ending fee is billed as its own invoice line so statements and reports
-- can show it separately from rent and late fees. Additive only.
ALTER TYPE "InvoiceLineItemKind" ADD VALUE IF NOT EXISTS 'EARLY_TERMINATION_FEE' AFTER 'ADJUSTMENT';
