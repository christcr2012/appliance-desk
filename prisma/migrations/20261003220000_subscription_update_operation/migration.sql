-- A durable record of moving a live subscription's end date when a renewal is signed
-- or cancelled, so the billing reconciliation pass can retry it. Additive only.
ALTER TYPE "ProviderOperationKind" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_UPDATE' AFTER 'SUBSCRIPTION_CANCEL';
