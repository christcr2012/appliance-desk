import { addBusinessDays, businessDateKey } from "@/lib/business-date";

export const TAX_RATE_CHANGES_RULE_KEY = "tax-rate-changes";
export const TAX_ADDRESS_RECHECK_RULE_KEY = "tax-address-recheck";

export function rateStartsTomorrow(
  effectiveFrom: Date,
  now: Date,
): boolean {
  return (
    businessDateKey(effectiveFrom) ===
    businessDateKey(addBusinessDays(now, 1))
  );
}

export function subscriptionTaxUpdateKey(
  agreementId: string,
  rateVersionId: string,
): string {
  return `sub-tax-${agreementId}-${rateVersionId}`;
}
