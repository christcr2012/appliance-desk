-- Batch K-2: retain the existing typed issue categories and recognize failed books
-- posting so an incomplete source never disappears without an owner review.
-- This changes no SystemIssue rows and preserves the old check semantics.
ALTER TABLE "SystemIssue" DROP CONSTRAINT "SystemIssue_kind_known";
ALTER TABLE "SystemIssue" ADD CONSTRAINT "SystemIssue_kind_known" CHECK ("kind" IN (
  'AUTOMATION_FAILED','AUTOMATION_STALE','PROVIDER_OPERATION_STUCK',
  'TAX_LOOKUP_UNAVAILABLE','TAX_PERIOD_MISSING','USE_TAX_FORM_MISSING',
  'SOURCE_PAGE_UNREACHABLE','SOURCE_PAGE_CHANGED','TAX_RATE_GUARDRAIL',
  'MESSAGE_DELIVERY_UNKNOWN','TELECOM_SYNC_STALE','TELECOM_STATEMENT_DIFFERENCE',
  'TELECOM_CONTACTS_UNRESOLVED','CONFIGURATION_MISSING','BOOKS_POSTING_FAILURE'
));
