/**
 * FEETAX-1: the drafted email to Greeley Sales Tax (spec FEE-TAXABILITY section 7).
 * The app drafts; Chris sends it from his own email so the written reply comes to
 * him. Nothing here sends mail. The questions match DQ-FEETAX-GREELEY-LEASE,
 * DQ-FEETAX-GREELEY-SERVICE and DQ-FEETAX-GREELEY-OTHER in docs/OWNER-INPUTS.md.
 */
export const GREELEY_SALES_TAX_EMAIL = "Greeley.SalesTax@greeleygov.com";

export function greeleyFeeEmailDraft(businessName: string): {
  to: string;
  subject: string;
  body: string;
  mailto: string;
} {
  const name = businessName.trim() || "Robinson Appliance Rentals";
  const subject = "Sales tax questions — appliance rentals and service fees";
  const body = [
    "Hello,",
    "",
    `I run ${name}, a family-owned washer and dryer rental business in Greeley. We rent appliances month to month, usually for 6 or 12 months, and we pay sales tax when we buy each appliance. Before we start renting, I want to collect the right city tax, so could you confirm three things in writing?`,
    "",
    "1. Rentals: do we owe Greeley sales tax on rent for rentals of 36 months or less when we already paid tax on the appliance when we bought it?",
    "",
    "2. Services: our delivery, installation, pickup at the end of a rental, and hauling away a customer's old appliance are each optional and listed as their own line with their own price, and the customer can choose to do each one themselves for free instead. Are those charges part of Greeley's taxed price — for rentals, and for appliances we sell?",
    "",
    "3. Other fees: are a damage waiver, a late fee, and our one-time setup fee taxed by Greeley?",
    "",
    "Thank you — a written reply helps us file correctly from day one.",
    "",
    "Chris Robinson",
    name,
  ].join("\n");
  return {
    to: GREELEY_SALES_TAX_EMAIL,
    subject,
    body,
    mailto: `mailto:${GREELEY_SALES_TAX_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}
